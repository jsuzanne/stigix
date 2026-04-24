import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { log } from './utils/logger.js';

/**
 * TargetScenario definition matches the configuration model.
 */
export interface TargetScenario {
    id: string;
    label: string;
    description: string;
    path: string;
    subdomain?: string;
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
    httpCode?: number;
    remoteIp?: string;
    remotePort?: number;
    metrics?: {
        dns_ms: number;
        tcp_ms: number;
        tls_ms: number;
        ttfb_ms: number;
        total_ms: number;
        size_bytes: number;
        speed_bps: number;
    };
}

const DEFAULT_SCENARIOS: TargetScenario[] = [
    {
        id: 'egress-info',
        label: 'Info / Egress',
        description: 'Identifies your public IP, Country and Cloudflare POP.',
        path: '/saas/info',
        category: 'info',
        subdomain: 'info'
    },
    {
        id: 'saas-slow',
        label: 'Slow SaaS',
        description: 'Simulates a 5s backend delay to test path selection.',
        path: '/saas/slow',
        category: 'saas',
        subdomain: 'slow'
    },
    {
        id: 'download-large',
        label: 'Large Download',
        description: 'Downloads a 10MB payload to test throughput.',
        path: '/download/large',
        category: 'download',
        subdomain: 'download'
    },
    {
        id: 'security-eicar',
        label: 'Security (EICAR)',
        description: 'Downloads the EICAR test file to check security policies.',
        path: '/security/eicar',
        category: 'security',
        subdomain: 'security'
    }
];

/**
 * TargetManager - Manages Cloudflare Target scenarios and signs URLs with the shared key.
 */
export class TargetManager {
    private scenarios: TargetScenario[] = [];
    private configDir: string;
    private configPath: string;
    private jsonConfigPath: string;
    private baseUrl: string = '';
    private sharedKey: string = '';

    constructor(configDir: string, baseUrl?: string) {
        this.configDir = configDir;
        this.configPath = path.join(configDir, 'target-scenarios.json');
        this.jsonConfigPath = path.join(configDir, 'cloud-config.json');
        
        this.reload(baseUrl);
        this.loadScenarios();
    }

    /**
     * Reloads configuration from disk and environment variables.
     */
    public reload(baseUrlOverride?: string) {
        // 1. Load from JSON if exists
        let jsonConfig: { masterKey?: string, baseUrl?: string } = {};
        if (fs.existsSync(this.jsonConfigPath)) {
            try { jsonConfig = JSON.parse(fs.readFileSync(this.jsonConfigPath, 'utf8')); } catch { }
        }

        // 2. Determine Base URL: JSON > Constructor Arg > Env > Default
        let rawBase = jsonConfig.baseUrl || baseUrlOverride || process.env.STIGIX_TARGET_BASE_URL || 'https://stigix-target.jlsuzanne.workers.dev';
        if (rawBase && !rawBase.startsWith('http')) {
            rawBase = `https://${rawBase}`;
        }
        this.baseUrl = rawBase;

        // 3. Derive Shared Key: SHA256(tsgId + ":" + MASTER_SIGNATURE_KEY)
        // MASTER_SIGNATURE_KEY is the only supported auth method.
        const masterKey = jsonConfig.masterKey || process.env.STIGIX_TARGET_MASTER_KEY;
        const tsgId = process.env.PRISMA_SDWAN_TSGID || process.env.PRISMA_SDWAN_TSG_ID || '';
        let key = '';

        if (masterKey && tsgId) {
            key = crypto.createHash('sha256').update(`${tsgId}:${masterKey}`).digest('hex');
            log('TARGET', `Master key derived for TSG ${tsgId} ${jsonConfig.masterKey ? '(UI config)' : '(ENV)'}`);
        } else if (masterKey && !tsgId) {
            log('TARGET', 'STIGIX_TARGET_MASTER_KEY set but PRISMA_SDWAN_TSGID is missing — target probes will be unauthorized', 'warn');
        } else {
            log('TARGET', 'No STIGIX_TARGET_MASTER_KEY configured — worker running in open-access mode', 'warn');
        }

        this.sharedKey = key;
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
            if (scenario.subdomain) {
                url.hostname = `${scenario.subdomain}.${url.hostname}`;
            }
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
     * Extracts URL parsing and signature logic for external use or logging.
     */
    getEffectiveUrl(scenarioId: string): { url: string, scenario?: TargetScenario } {
        let scenario: TargetScenario | undefined;
        let signedUrl = '';
        let baseId = scenarioId;
        let overrides: { delay?: number; size?: string; code?: number; mode?: string } = {};

        if (scenarioId.includes('#')) {
            const parts = scenarioId.split('#');
            baseId = parts[0];
            try { overrides = JSON.parse(parts[1]); } catch { }
        }

        if (baseId === 'advanced-custom') {
            scenario = {
                id: scenarioId,
                label: 'Advanced Stigix Probe',
                description: 'Dynamic custom target',
                path: '/advanced',
                params: { mode: overrides.mode || 'info', delay: overrides.delay || 0 },
                category: overrides.mode === 'large' ? 'download' : overrides.mode === 'error' ? 'error' : overrides.mode === 'eicar' ? 'security' : 'info'
            };
            if (overrides.mode === 'large') {
                scenario.params!.size = overrides.size || '5m';
                scenario.subdomain = 'download';
            }
            if (overrides.mode === 'error') {
                scenario.params!.code = overrides.code || 500;
                scenario.subdomain = 'error';
            }
            if (overrides.mode === 'info') scenario.subdomain = 'info';
            if (overrides.mode === 'slow' || overrides.delay && overrides.delay > 0) scenario.subdomain = 'slow';
            if (overrides.mode === 'eicar') scenario.subdomain = 'security';

            if (!this.baseUrl) return { url: '', scenario };
            const url = new URL(this.baseUrl);
            url.pathname = scenario.path;
            if (this.sharedKey) {
                url.searchParams.set('key', this.sharedKey);
                const tsgId = process.env.PRISMA_SDWAN_TSGID || process.env.PRISMA_SDWAN_TSG_ID;
                if (tsgId) url.searchParams.set('tsg', tsgId);
            }
            if (scenario.params) Object.entries(scenario.params).forEach(([k, v]) => url.searchParams.set(k, v.toString()));
            signedUrl = url.toString();
        } else {
            scenario = this.scenarios.find(s => s.id === baseId);
            if (!scenario || !this.baseUrl) {
                return { url: '', scenario };
            }
            const signedScenarios = this.getScenarios();
            const signedScenario = signedScenarios.find(s => s.id === baseId);
            if (!signedScenario?.signedUrl) {
                return { url: '', scenario };
            }
            
            const url = new URL(signedScenario.signedUrl);
            if (overrides.delay !== undefined) {
                url.searchParams.set('delay', overrides.delay.toString());
            }
            signedUrl = url.toString();
        }

        return { url: signedUrl, scenario };
    }

    /**
     * Executes a scenario as a probe and returns a standardized result.
     */
    async runProbe(scenarioId: string): Promise<TargetProbeResult> {
        const { url: signedUrl, scenario } = this.getEffectiveUrl(scenarioId);

        if (!signedUrl || !scenario) {
            return { success: false, score: 0, latency_ms: 0, message: 'Scenario or Base URL missing' };
        }

        const startTime = Date.now();
        try {
            const execPromise = promisify(exec);
            const tmpFile = path.join(os.tmpdir(), `stigix_cloud_${Date.now()}_${Math.random().toString(36).substring(7)}.tmp`);
            
            // Output only metrics to stdout, save body to temp file
            const curlCmd = `curl -s -L -w "%{time_namelookup},%{time_connect},%{time_appconnect},%{time_starttransfer},%{time_total},%{http_code},%{size_download},%{speed_download},%{remote_ip},%{remote_port}" -o "${tmpFile}" --max-time 15 "${signedUrl}"`;
            
            log('TARGET', `[CLOUD PROBE] Executing: ${curlCmd}`, 'debug');
            const { stdout } = await execPromise(curlCmd, { maxBuffer: 1024 * 1024 });
            
            const [t_name, t_conn, t_app, t_start, t_tot, codeStr, sizeStr, speedStr, r_ip, r_port] = stdout.trim().split(',');
            const statusCode = parseInt(codeStr) || 0;
            const latency = parseFloat(t_tot) * 1000 || (Date.now() - startTime);

            const dns_ms = parseFloat(t_name) * 1000;
            const tcp_ms = (parseFloat(t_conn) - parseFloat(t_name)) * 1000;
            const tls_ms = parseFloat(t_app) > 0 ? (parseFloat(t_app) - parseFloat(t_conn)) * 1000 : 0;
            const ttfb_ms = (parseFloat(t_start) - Math.max(parseFloat(t_app), parseFloat(t_conn))) * 1000;
            
            const metrics = {
                dns_ms: Math.max(0, dns_ms),
                tcp_ms: Math.max(0, tcp_ms),
                tls_ms: Math.max(0, tls_ms),
                ttfb_ms: Math.max(0, ttfb_ms),
                total_ms: latency,
                size_bytes: parseInt(sizeStr) || 0,
                speed_bps: parseFloat(speedStr) || 0
            };

            let bodyStr = '';
            if (fs.existsSync(tmpFile)) {
                if (scenario.category === 'info') {
                    bodyStr = fs.readFileSync(tmpFile, 'utf8');
                }
                fs.unlinkSync(tmpFile);
            }

            if (statusCode >= 400 || statusCode === 0) {
                const failResp = { success: false, score: 0, latency_ms: latency, message: `HTTP ${statusCode}`, metrics, httpCode: statusCode, remoteIp: r_ip, remotePort: parseInt(r_port) };
                log('TARGET', `[CLOUD PROBE] Response Error: ${JSON.stringify(failResp, null, 2)}`, 'debug');
                return failResp;
            }

            if (scenario.category === 'info') {
                let data: any = {};
                try { data = JSON.parse(bodyStr); } catch { }
                const jsonResp = {
                    success: true,
                    score: 100, // Info doesn't really have a performance score, but it's "success"
                    latency_ms: latency,
                    message: `Egress recognized: ${data.ip || 'Unknown'}`,
                    data: {
                        ip: data.ip || 'Unknown',
                        country: data.country || 'Unknown',
                        city: data.city || 'Unknown',
                        pop: data.colo || 'Unknown'
                    },
                    metrics,
                    httpCode: statusCode, remoteIp: r_ip, remotePort: parseInt(r_port)
                };
                return jsonResp;
            }

            if (scenario.category === 'saas' || scenario.id === 'saas-slow') {
                const score = Math.max(0, Math.min(100, Math.round(100 * (1 - (latency - 200) / 4800))));
                const resp = { success: true, score, latency_ms: latency, message: `Response received in ${Math.round(latency)}ms`, metrics, httpCode: statusCode, remoteIp: r_ip, remotePort: parseInt(r_port) };
                return resp;
            }

            if (scenario.category === 'download') {
                const score = Math.max(0, Math.min(100, Math.round(100 * (1 - (latency - 1000) / 9000))));
                const resp =  { success: true, score, latency_ms: latency, message: `Download complete`, metrics, httpCode: statusCode, remoteIp: r_ip, remotePort: parseInt(r_port) };
                return resp;
            }

            if (scenario.category === 'security') {
                const resp = { success: true, score: 100, latency_ms: latency, message: 'Endpoint reachable', metrics, httpCode: statusCode, remoteIp: r_ip, remotePort: parseInt(r_port) };
                return resp;
            }

            const okResp = { success: true, score: 100, latency_ms: latency, message: 'OK', metrics, httpCode: statusCode, remoteIp: r_ip, remotePort: parseInt(r_port) };
            return okResp;

        } catch (error: any) {
            const latency = Date.now() - startTime;
            const errResp = { success: false, score: 0, latency_ms: latency, message: error.message };
            log('TARGET', `[CLOUD PROBE] Exception: ${JSON.stringify(errResp, null, 2)}`, 'debug');
            return errResp;
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
