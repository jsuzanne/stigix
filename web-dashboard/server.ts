import express from 'express';
import * as cheerio from 'cheerio';
import net from 'net';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
//import { spawn, exec } from 'child_process';
import { spawn, exec, execSync } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import os from 'os';
import jwt from 'jsonwebtoken';
import { log } from './utils/logger.js';
import bcrypt from 'bcryptjs';
import { TestLogger, TestResult } from './test-logger.js';
import { ConnectivityLogger, ConnectivityResult } from './connectivity-logger.js';
import { URL_CATEGORIES, DNS_TEST_DOMAINS } from './shared/security-categories.js';
import { IoTManager, IoTDeviceConfig } from './iot-manager.js';
import { VyosManager } from './vyos-manager.js';
import { VyosScheduler } from './vyos-scheduler.js';
import { SiteManager } from './site-manager.js';
import { DiscoveryManager, DiscoveredProbe } from './discovery-manager.js';
import { createServer } from 'http';
import { TargetsManager } from './targets-manager.js';
import { RegistryManager } from './registry-manager.js';
import { LocalRegistryServer } from './local-registry-server.js';

import { Server } from 'socket.io';
import multer from 'multer';

// Multer setup for EDL file uploads (memory storage)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Robust project root detection.
 * Handles both containerized (flattened) and local (hierarchical) environments.
 */
function findProjectRoot() {
    // 1. Check current directory (Flattened layout in container: /app/server.ts)
    if (fs.existsSync(path.join(__dirname, 'VERSION')) && fs.existsSync(path.join(__dirname, 'engines'))) {
        return __dirname;
    }
    // 2. Check parent directory (Standard layout in dev: web-dashboard/server.ts)
    const parent = path.join(__dirname, '..');
    if (fs.existsSync(path.join(parent, 'VERSION')) && fs.existsSync(path.join(parent, 'engines'))) {
        return parent;
    }
    // Fallback: Default to parent but log warning
    console.warn(`[SYSTEM] ⚠️ Could not clearly identify project root, falling back to: ${parent}`);
    return parent;
}

const PROJECT_ROOT = findProjectRoot();
log('SYSTEM', `🚀 Project Root: ${PROJECT_ROOT}`);

/**
 * Get the path to the Python interpreter.
 * Prefers the virtual environment in engines/.venv if it exists.
 */
function getPythonPath() {
    const venvPath = path.join(PROJECT_ROOT, 'engines', '.venv', 'bin', 'python3');
    if (fs.existsSync(venvPath)) {
        return venvPath;
    }
    return 'python3';
}
const PYTHON_PATH = getPythonPath();
log('SYSTEM', `🐍 Python Path: ${PYTHON_PATH}`);

// Configuration Paths - Environment aware
const APP_CONFIG = {
    // Check for config in PROJECT_ROOT/config
    configDir: path.resolve(process.env.CONFIG_DIR || path.join(PROJECT_ROOT, 'config')),
    // Fallback to local logs if /var/log is not accessible (dev mode)
    logDir: path.resolve(process.env.LOG_DIR || (fs.existsSync('/var/log/sdwan-traffic-gen') ? '/var/log/sdwan-traffic-gen' : path.join(PROJECT_ROOT, 'logs')))
};

const DEBUG = process.env.DEBUG === 'true';

// Quick Targets for XFR: "Label1:IP1,Label2:IP2"
const QUICK_TARGETS_RAW = process.env.XFR_QUICK_TARGETS || '';
const XFR_QUICK_TARGETS = QUICK_TARGETS_RAW.split(',')
    .filter(x => x.includes(':'))
    .map(x => {
        const [label, host] = x.split(':');
        // Strip quotes and trim
        const cleanLabel = label.trim().replace(/^["']|["']$/g, '');
        const cleanHost = host.trim().replace(/^["']|["']$/g, '');
        return { label: cleanLabel, host: cleanHost };
    });

// Shared Targets Manager (config/targets.json + synthesized from legacy configs)
const registryManager = new RegistryManager(APP_CONFIG.configDir);
const targetsManager = new TargetsManager(APP_CONFIG.configDir, XFR_QUICK_TARGETS, registryManager);
log('SYSTEM', `🎯 Targets Manager initialized`);

// Start Registry Service
registryManager.start().catch(e => log('REGISTRY', `Failed to start: ${e.message}`, 'error'));

if (DEBUG) {
    log('SYSTEM', `📂 Configuration Directory: ${APP_CONFIG.configDir}`);
    log('SYSTEM', `📝 Log Directory: ${APP_CONFIG.logDir}`);
}

// Initialize Test Logger with configurable retention
const LOG_RETENTION_DAYS = parseInt(process.env.LOG_RETENTION_DAYS || '7');
const LOG_MAX_SIZE_MB = parseInt(process.env.LOG_MAX_SIZE_MB || '100');
const testLogger = new TestLogger(APP_CONFIG.logDir, LOG_RETENTION_DAYS, LOG_MAX_SIZE_MB);

if (DEBUG) console.log(`Test Logger initialized: retention=${LOG_RETENTION_DAYS} days, max_size=${LOG_MAX_SIZE_MB}MB`);

// DEM Connectivity Logger
const connectivityLogger = new ConnectivityLogger(APP_CONFIG.logDir, LOG_RETENTION_DAYS, LOG_MAX_SIZE_MB);
if (DEBUG) console.log(`Connectivity Logger initialized (DEM)`);

// Test Counter - Persistent sequential ID for all tests
const TEST_COUNTER_FILE = path.join(APP_CONFIG.configDir, 'test-counter.json');
// Obsolete files removed
const VOICE_COUNTER_FILE_LEGACY = path.join(APP_CONFIG.configDir, 'voice-counter.json');
// Obsolete files removed
const VOICE_STATS_FILE = path.join(APP_CONFIG.logDir, 'voice-stats.jsonl');
const CONVERGENCE_HISTORY_FILE = path.join(APP_CONFIG.logDir, 'convergence-history.jsonl');
const CONVERGENCE_STATS_FILE = '/tmp/convergence_stats.json';
const CONVERGENCE_COUNTER_FILE = path.join(APP_CONFIG.configDir, 'convergence-counter.json');
const CONVERGENCE_ENDPOINTS_FILE = path.join(APP_CONFIG.configDir, 'convergence-endpoints.json');

// ─── Egress Path Enrichment Helpers ────────────────────────────────────────

// Debug mode: set DEBUG=true in .env or docker-compose env to enable verbose logging
const debugMode = process.env.DEBUG === 'true';
const dbg = (...args: any[]) => { if (debugMode) console.log(...args); };

/**
 * Spawn getflow.py and return parsed JSON, or null on any error.
 * Fire-and-forget safe: never throws, always resolves.
 */
async function runGetflow(siteName: string, sourcePort: number, dstIp: string): Promise<any> {
    return new Promise((resolve) => {
        try {
            // engines/ is mounted inside the Docker container (same as convergence_orchestrator.py)
            const scriptPath = path.join(PROJECT_ROOT, 'engines', 'getflow.py');
            dbg(`[CONV] [DEBUG] runGetflow: scriptPath=${scriptPath} exists=${fs.existsSync(scriptPath)}`);
            if (!fs.existsSync(scriptPath)) {
                console.warn(`[CONV] getflow.py not found at: ${scriptPath}`);
                resolve(null);
                return;
            }
            const args = [
                scriptPath,
                '--site-name', siteName,
                '--udp-src-port', String(sourcePort),
                '--dst-ip', dstIp,
                '--minutes', '5',
                '--json'
            ];
            dbg(`[CONV] [DEBUG] Spawning: python3 ${args.join(' ')}`);
            const proc = spawn(PYTHON_PATH, args, { timeout: 30_000 });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
            proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
            proc.on('close', (code) => {
                dbg(`[CONV] [DEBUG] getflow exited code=${code} stdout_len=${stdout.length} stderr=${stderr.slice(0, 200)}`);
                try { resolve(JSON.parse(stdout)); }
                catch { resolve(null); }
            });
            proc.on('error', (e) => {
                dbg(`[CONV] [DEBUG] getflow spawn error: ${e.message}`);
                resolve(null);
            });
        } catch (e: any) {
            dbg(`[CONV] [DEBUG] runGetflow exception: ${e.message}`);
            resolve(null);
        }
    });
}

/**
 * Find a convergence history entry by testId and merge extra fields.
 * Uses atomic .tmp + rename write to prevent file corruption.
 */
async function enrichConvergenceHistory(testId: string, extra: Record<string, any>): Promise<boolean> {
    try {
        if (!fs.existsSync(CONVERGENCE_HISTORY_FILE)) {
            dbg(`[CONV] [DEBUG] enrichConvergenceHistory: history file not found`);
            return false;
        }
        const raw = await fs.promises.readFile(CONVERGENCE_HISTORY_FILE, 'utf-8');
        const lines = raw.split('\n').filter(Boolean);
        let found = false;
        const updated = lines.map(line => {
            try {
                const obj = JSON.parse(line);
                // Orchestrator writes `test_id` (snake_case), may include label: "CONV-0075 (DC1)"
                // JS handler writes `testId` (camelCase). Check both with startsWith for label tolerance.
                const recordId: string = obj.test_id || obj.testId || '';
                if (recordId === testId || recordId.startsWith(testId + ' ') || recordId.startsWith(testId + '(')) {
                    found = true;
                    dbg(`[CONV] [DEBUG] enrichConvergenceHistory: matched record id="${recordId}" for testId="${testId}"`);
                    return JSON.stringify({ ...obj, ...extra });
                }
                return line;
            } catch {
                return line;
            }
        });
        if (!found) {
            dbg(`[CONV] [DEBUG] enrichConvergenceHistory: no match for testId="${testId}" in ${lines.length} records`);
            return false;
        }
        const tmp = CONVERGENCE_HISTORY_FILE + '.tmp';
        await fs.promises.writeFile(tmp, updated.join('\n') + '\n', 'utf-8');
        await fs.promises.rename(tmp, CONVERGENCE_HISTORY_FILE);
        return true;
    } catch (e: any) {
        console.warn(`[CONV] enrichConvergenceHistory failed: ${e.message}`);
        return false;
    }
}

// ───────────────────────────────────────────────────────────────────────────

// Batch Counter - Persistent rotating ID for batch tests
const BATCH_COUNTER_FILE = path.join(APP_CONFIG.configDir, 'batch-counter.json');

// NEW Unified Configurations
const VOICE_CONFIG_FILE = path.join(APP_CONFIG.configDir, 'voice-config.json');
const SECURITY_CONFIG_FILE = path.join(APP_CONFIG.configDir, 'security-config.json');
const SECURITY_HISTORY_FILE = path.join(APP_CONFIG.logDir, 'security-history.jsonl');

// IoT Devices
const IOT_DEVICES_FILE = path.join(APP_CONFIG.configDir, 'iot-devices.json');

// NEW Unified Configurations (v1.2.1-patch.57)
const APPLICATIONS_CONFIG_FILE = path.join(APP_CONFIG.configDir, 'applications-config.json');
const VYOS_CONFIG_FILE = path.join(APP_CONFIG.configDir, 'vyos-config.json');
const CONVERGENCE_CONFIG_FILE = path.join(APP_CONFIG.configDir, 'convergence-config.json');
const ICON_CACHE_FILE = path.join(APP_CONFIG.configDir, 'icon-cache.json');

// --- Favicon Discovery & Caching System ---
interface IconCacheEntry {
    domain: string;
    faviconUrl: string;
    lastChecked: number;
    status: 'success' | 'failed';
}

/**
 * Intelligent favicon discovery.
 * Checks /favicon.ico first, then parses HTML for <link> tags.
 */
async function fetchFavicon(domain: string, endpoint: string = '/'): Promise<string | null> {
    const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0];
    const baseUrl = `https://${cleanDomain}`;
    const testUrl = `${baseUrl}${endpoint}`;

    dbg(`[ICON] Discovering favicon for ${cleanDomain}...`);

    try {
        // Step 1: Try direct /favicon.ico (Fastest)
        const directIco = `${baseUrl}/favicon.ico`;
        const icoRes = await fetch(directIco, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
        if (icoRes.ok && icoRes.headers.get('content-type')?.includes('image')) {
            return directIco;
        }

        // Step 2: Fetch HTML and parse for link tags
        const htmlRes = await fetch(testUrl, { signal: AbortSignal.timeout(3000) });
        if (!htmlRes.ok) return null;

        const html = await htmlRes.text();
        const $ = cheerio.load(html);
        const iconLinks = $('link[rel*="icon"], link[rel*="shortcut"], link[rel*="apple-touch-icon"]');

        let bestIcon: string | null = null;
        let bestPriority = -1;

        iconLinks.each((_, el) => {
            const rel = $(el).attr('rel') || '';
            const href = $(el).attr('href');
            if (!href) return;

            let priority = 0;
            if (rel.includes('apple-touch-icon')) priority = 3;
            else if (rel === 'icon') priority = 2;
            else if (rel.includes('shortcut')) priority = 1;

            if (priority > bestPriority) {
                bestPriority = priority;
                bestIcon = href;
            }
        });

        if (typeof bestIcon === 'string') {
            const iconStr = bestIcon as string;
            // Resolve relative URLs
            if (iconStr.startsWith('//')) return `https:${iconStr}`;
            if (iconStr.startsWith('/')) return `${baseUrl}${iconStr}`;
            if (!iconStr.startsWith('http')) return `${baseUrl}/${iconStr}`;
            return iconStr;
        }

        return null;
    } catch (e: any) {
        dbg(`[ICON] Error discoverng icon for ${domain}: ${e.message}`);
        return null;
    }
}

function getIconCache(): Record<string, IconCacheEntry> {
    try {
        if (fs.existsSync(ICON_CACHE_FILE)) {
            return JSON.parse(fs.readFileSync(ICON_CACHE_FILE, 'utf-8'));
        }
    } catch { }
    return {};
}

function saveIconCache(entry: IconCacheEntry) {
    const cache = getIconCache();
    cache[entry.domain] = entry;
    try {
        fs.writeFileSync(ICON_CACHE_FILE, JSON.stringify(cache, null, 2));
    } catch (e: any) {
        console.error(`[ICON] Failed to save cache: ${e.message}`);
    }
}

// --- XFR Speedtest Models & Manager ---
interface XfrTestParams {
    host: string;
    port: number;
    protocol: 'tcp' | 'udp' | 'quic';
    duration_sec: number;
    bitrate: string;
    parallel_streams: number;
    direction: 'client-to-server' | 'server-to-client' | 'bidirectional';
    psk?: string;
    mode: 'default' | 'custom';
}

interface XfrTestResultSummary {
    protocol: string;
    duration_sec: number;
    sent_mbps: number;
    received_mbps: number;
    loss_percent: number;
    rtt_ms_avg: number;
    rtt_ms_min: number;
    rtt_ms_max: number;
    jitter_ms_avg: number;
}

interface XfrTestResultInterval {
    timestamp: string;
    sent_mbps: number;
    received_mbps: number;
    loss_percent: number;
    rtt_ms: number;
}

interface XfrJob {
    id: string;
    sequence_id: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    params: XfrTestParams;
    started_at: string | null;
    finished_at: string | null;
    summary: XfrTestResultSummary | null;
    intervals: XfrTestResultInterval[];
    error: string | null;
    process?: any;
    listeners: Set<(data: any) => void>;
}

const XFR_DEFAULTS: XfrTestParams = {
    host: process.env.TARGET_IP || '',
    port: 5201,
    protocol: 'tcp',
    duration_sec: 10,
    bitrate: '200M',
    parallel_streams: 4,
    direction: 'client-to-server',
    mode: 'default'
};

/**
 * Robust binary detection for xfr
 */
function findXfrBinary(): string {
    const commonPaths = ['/usr/bin/xfr', '/usr/local/bin/xfr', '/app/xfr'];
    for (const p of commonPaths) {
        if (fs.existsSync(p)) return p;
    }
    try {
        const whichRes = execSync('which xfr', { encoding: 'utf8' }).trim();
        if (whichRes) return whichRes;
    } catch (e) { }
    return 'xfr'; // Fallback to path
}

const XFR_BINARY = findXfrBinary();

class XfrJobManager {
    private jobs: Map<string, XfrJob> = new Map();
    private sequenceCounter: number = 0;
    private historyFile: string;

    constructor() {
        this.historyFile = path.join(APP_CONFIG.configDir, 'xfr-history.json');
        this.loadHistory();
    }

    private saveHistory() {
        try {
            const data = Array.from(this.jobs.values())
                .sort((a, b) => b.sequence_id.localeCompare(a.sequence_id))
                .slice(0, 50) // Keep last 50
                .map(j => ({
                    id: j.id,
                    sequence_id: j.sequence_id,
                    status: j.status,
                    params: j.params,
                    started_at: j.started_at,
                    finished_at: j.finished_at,
                    summary: j.summary,
                    intervals: j.intervals,
                    error: j.error
                }));
            fs.writeFileSync(this.historyFile, JSON.stringify({ jobs: data, counter: this.sequenceCounter }, null, 2));
        } catch (e) {
            console.error('Failed to save xfr history', e);
        }
    }

    private loadHistory() {
        try {
            if (fs.existsSync(this.historyFile)) {
                const raw = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
                this.sequenceCounter = raw.counter || 0;
                (raw.jobs || []).forEach((j: any) => {
                    this.jobs.set(j.id, { ...j, listeners: new Set() });
                });
            }
        } catch (e) {
            console.error('Failed to load xfr history', e);
        }
    }

    createJob(params: Partial<XfrTestParams>): string {
        this.sequenceCounter++;
        const seqId = `XFR-${this.sequenceCounter.toString().padStart(4, '0')}`;
        const id = `xfr_${new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15)}_${Math.floor(Math.random() * 10000)}`;
        const mergedParams: XfrTestParams = { ...XFR_DEFAULTS, ...params };

        const job: XfrJob = {
            id,
            sequence_id: seqId,
            status: 'queued',
            params: mergedParams,
            started_at: null,
            finished_at: null,
            summary: null,
            intervals: [],
            error: null,
            listeners: new Set()
        };

        this.jobs.set(id, job);
        this.saveHistory();
        return id;
    }

    getJob(id: string): XfrJob | undefined {
        return this.jobs.get(id);
    }

    getAllJobs(): XfrJob[] {
        return Array.from(this.jobs.values()).sort((a, b) => b.sequence_id.localeCompare(a.sequence_id));
    }

    private logToXfrFile(job: XfrJob, message: string) {
        const xfrLogFile = path.join(APP_CONFIG.logDir, 'xfr.log');
        const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
        const logLine = `[${ts}] [${job.sequence_id}] ${message}\n`;
        try {
            fs.appendFileSync(xfrLogFile, logLine);
        } catch (e) {
            console.error('Failed to write to xfr.log', e);
        }
    }

    private handleParsedXfrData(job: XfrJob, parsed: any) {
        // Summary object has bytes_total, whereas intervals don't.
        if (parsed.bytes_total !== undefined || parsed.type === 'summary') {
            job.summary = this.mapSummary(parsed);
        } else if (parsed.type === 'interval' || parsed.throughput_mbps !== undefined) {
            const val = parsed.throughput_mbps || 0;
            const timestamp = parsed.timestamp && !isNaN(Date.parse(parsed.timestamp))
                ? parsed.timestamp
                : new Date().toISOString();

            const interval: XfrTestResultInterval = {
                timestamp,
                sent_mbps: job.params.direction === 'server-to-client' ? 0 : val,
                received_mbps: job.params.direction === 'server-to-client' ? val : 0,
                loss_percent: parsed.loss_percent || 0,
                rtt_ms: (parsed.rtt_us || parsed.tcp_info?.rtt_us || 0) / 1000
            };

            // Handling bidirectional
            if (job.params.direction === 'bidirectional') {
                interval.sent_mbps = parsed.sent_mbps || val;
                interval.received_mbps = parsed.received_mbps || val;
            }

            job.intervals.push(interval);
            this.notifyListeners(job, { type: 'interval', data: interval });

            // Log real-time interval to file
            const mbps = interval.sent_mbps || interval.received_mbps;
            this.logToXfrFile(job, `[Interval] ${mbps.toFixed(2)} Mbps (Loss: ${interval.loss_percent.toFixed(2)}%)`);
        }
    }

    private checkReachability(host: string, port: number, timeout: number = 2000): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let resolved = false;

            socket.setTimeout(timeout);

            socket.on('connect', () => {
                resolved = true;
                socket.destroy();
                resolve(true);
            });

            socket.on('timeout', () => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve(false);
                }
            });

            socket.on('error', () => {
                if (!resolved) {
                    resolved = true;
                    socket.destroy();
                    resolve(false);
                }
            });

            socket.connect(port, host);
        });
    }

    async startJob(id: string) {
        const job = this.jobs.get(id);
        if (!job || job.status !== 'queued') return;

        job.status = 'running';
        job.started_at = new Date().toISOString();

        // 1. Pre-test Connectivity Check (TCP Only)
        let isReachable = true;
        if (job.params.protocol !== 'udp' && job.params.protocol !== 'quic') {
            this.logToXfrFile(job, `Performing pre-test connectivity check to ${job.params.host}:${job.params.port}...`);
            isReachable = await this.checkReachability(job.params.host, job.params.port);
        } else {
            this.logToXfrFile(job, `Skipping TCP pre-check for ${job.params.protocol.toUpperCase()}. Relying on native timeout...`);
        }

        if (!isReachable) {
            job.status = 'failed';
            job.error = `Target host/port unreachable (${job.params.host}:${job.params.port})`;
            job.finished_at = new Date().toISOString();
            log('XFR', `[${job.sequence_id}] Pre-test connectivity check failed: ${job.error}`);
            this.notifyListeners(job, { type: 'done', data: { status: 'failed', error: job.error } });
            this.logToXfrFile(job, `Test failed: ${job.error}`);
            this.saveHistory();
            return;
        }
        this.logToXfrFile(job, `Target validation complete. Launching test...`);

        const args = this.buildArgs(job);
        log('XFR', `[${job.sequence_id}] Launching: ${XFR_BINARY} ${args.join(' ')}`);
        this.logToXfrFile(job, `Test started: ${job.params.protocol.toUpperCase()} ${job.params.direction} to ${job.params.host}:${job.params.port} (${job.params.duration_sec}s, ${job.params.bitrate || 'Max BW'})`);

        try {
            const child = spawn(XFR_BINARY, args);
            job.process = child;

            let buffer = '';
            child.stdout.on('data', (data) => {
                buffer += data.toString();

                // Robust JSON stream parsing for potentially multi-line objects
                let startIdx = buffer.indexOf('{');
                while (startIdx !== -1) {
                    let depth = 0;
                    let endIdx = -1;
                    for (let i = startIdx; i < buffer.length; i++) {
                        if (buffer[i] === '{') depth++;
                        else if (buffer[i] === '}') {
                            depth--;
                            if (depth === 0) {
                                endIdx = i;
                                break;
                            }
                        }
                    }

                    if (endIdx !== -1) {
                        const jsonStr = buffer.substring(startIdx, endIdx + 1);
                        try {
                            const parsed = JSON.parse(jsonStr);
                            this.handleParsedXfrData(job, parsed);
                        } catch (e) {
                            // Invalid or partial JSON, just log it as raw for debug if needed
                        }
                        buffer = buffer.substring(endIdx + 1);
                        startIdx = buffer.indexOf('{');
                    } else {
                        break; // Wait for more data to close the brace
                    }
                }
            });

            child.on('close', (code) => {
                job.status = code === 0 ? 'completed' : 'failed';
                job.finished_at = new Date().toISOString();
                if (code !== 0 && !job.summary) job.error = `Process exited with code ${code}`;

                this.notifyListeners(job, { type: 'done', data: { status: job.status } });

                if (job.status === 'completed' && job.summary) {
                    const res = job.summary;
                    log('XFR', `[${job.sequence_id}] completed: ${res.received_mbps.toFixed(2)} Mbps | Loss: ${res.loss_percent.toFixed(2)}% | RTT: ${res.rtt_ms_avg.toFixed(1)}ms`);
                } else if (job.status === 'failed' && !job.summary) {
                    log('XFR', `[${job.sequence_id}] ⚠️  No data received from ${job.params.host}:${job.params.port} (exit code ${code}) — target may not be responding on this port/protocol`, 'warn');
                } else {
                    log('XFR', `[${job.sequence_id}] finished with status ${job.status} ${job.error ? `(${job.error})` : ''}`);
                }

                if (job.status === 'completed' && job.summary) {
                    this.logToXfrFile(job, `Test completed: ${job.summary.received_mbps.toFixed(2)} Mbps, Loss: ${job.summary.loss_percent.toFixed(2)}%, Latency: ${job.summary.rtt_ms_avg.toFixed(1)}ms`);
                } else {
                    this.logToXfrFile(job, `Test failed: ${job.error || 'Unknown error'}`);
                }
                this.saveHistory();
            });

        } catch (e: any) {
            job.status = 'failed';
            job.error = e.message;
            this.notifyListeners(job, { type: 'done', data: { status: 'failed', error: e.message } });
            this.logToXfrFile(job, `Execution error: ${e.message}`);
            this.saveHistory();
        }
    }

    private buildArgs(job: XfrJob): string[] {
        const p = job.params;
        const args = [p.host, '-p', p.port.toString(), '--no-tui', '--json-stream'];

        // Deterministic source port: 40000 + (sequence sequence_id numeric)
        // ONLY for UDP/QUIC as TCP doesn't support --cport in xfr engine
        const seqMatch = job.sequence_id.match(/\d+/);
        if (seqMatch && (p.protocol === 'udp' || p.protocol === 'quic')) {
            const seqNum = parseInt(seqMatch[0], 10);
            const sourcePort = 40000 + (seqNum % 10000); // 40000-49999 range
            args.push('--cport', sourcePort.toString());
        }

        if (p.protocol === 'udp') args.push('-u');
        if (p.protocol === 'quic') args.push('-Q');

        if (p.duration_sec > 0) args.push('-t', `${p.duration_sec}s`);

        // Bitrate: omit if empty, "0", or "max" (case insensitive)
        const b = p.bitrate ? p.bitrate.toString().trim() : "";
        if (b && b !== '0' && b.toLowerCase() !== 'max') {
            args.push('-b', b);
        }

        if (p.parallel_streams > 1) args.push('-P', p.parallel_streams.toString());
        if (p.psk) args.push('--psk', p.psk);

        if (p.direction === 'server-to-client') args.push('-R');
        else if (p.direction === 'bidirectional') args.push('--bidir');

        return args;
    }

    private mapSummary(p: any): XfrTestResultSummary {
        return {
            protocol: p.protocol || 'tcp',
            duration_sec: p.duration_sec || (p.duration_ms ? p.duration_ms / 1000 : 0),
            sent_mbps: p.throughput_mbps || p.sent_mbps || 0,
            received_mbps: p.throughput_mbps || p.received_mbps || 0,
            loss_percent: p.loss_percent || 0,
            rtt_ms_avg: p.rtt_ms_avg || (p.tcp_info?.rtt_us ? p.tcp_info.rtt_us / 1000 : 0),
            rtt_ms_min: p.rtt_ms_min || 0,
            rtt_ms_max: p.rtt_ms_max || 0,
            jitter_ms_avg: p.jitter_ms_avg || 0
        };
    }

    private notifyListeners(job: XfrJob, data: any) {
        job.listeners.forEach(l => l(data));
    }

    addListener(id: string, listener: (data: any) => void) {
        const job = this.jobs.get(id);
        if (job) job.listeners.add(listener);
    }

    removeListener(id: string, listener: (data: any) => void) {
        const job = this.jobs.get(id);
        if (job) job.listeners.delete(listener);
    }
}

const xfrManager = new XfrJobManager();

// End of XFR Models & Manager

// --- Upgrade Status tracking ---
interface UpgradeStatus {
    inProgress: boolean;
    version: string | null;
    stage: 'idle' | 'pulling' | 'restarting' | 'failed' | 'complete';
    logs: string[];
    error: string | null;
    startTime: number | null;
}

let G_UPGRADE_STATUS: UpgradeStatus = {
    inProgress: false,
    version: null,
    stage: 'idle',
    logs: [],
    error: null,
    startTime: null
};

const getInterface = (): string => {
    const interfacesFile = path.join(APP_CONFIG.configDir, 'interfaces.txt');

    // 1. Primary Source: interfaces.txt
    if (fs.existsSync(interfacesFile)) {
        try {
            const content = fs.readFileSync(interfacesFile, 'utf8');
            const cleanLines = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'));

            if (cleanLines.length > 0) {
                if (DEBUG) console.log(`📡 [SYSTEM] Using interface: ${cleanLines[0]} (Source: interfaces.txt)`);
                return cleanLines[0];
            }
        } catch (e) {
            console.warn('⚠️ [SYSTEM] Failed to read interfaces.txt', e);
        }
    }

    // 2. Auto-detect fallback (Host Mode) - Prefer ip route
    try {

        const output = execSync("ip route | grep '^default' | awk '{print $5}' | head -n 1", {
            encoding: 'utf8',
            timeout: 2000
        }).trim();
        if (output) {
            if (DEBUG) console.log(`📡 [SYSTEM] Auto-detected interface: ${output} (Source: ip route)`);
            return output;
        }
    } catch (e) {
        // Silently fail to next step
    }

    // 3. Last Resort Fallback - os.networkInterfaces()
    try {
        const nets = os.networkInterfaces();
        const candidates: string[] = [];
        for (const name of Object.keys(nets)) {
            // Exclude loopback and common virtual/bridge interfaces if possible
            if (!name.startsWith('lo') &&
                !name.startsWith('docker') &&
                !name.startsWith('br-') &&
                !name.startsWith('veth') &&
                !name.startsWith('vnet') &&
                !name.startsWith('virbr') &&
                !name.startsWith('tailscale')) {
                candidates.push(name);
            }
        }

        // Priority: en* (physical), ens* (physical), eth* (common)
        const best = candidates.find(c => c.startsWith('en')) ||
            candidates.find(c => c.startsWith('eth')) ||
            candidates[0];

        if (best) {
            if (DEBUG) console.log(`📡 [SYSTEM] Auto-detected interface: ${best} (Source: os.networkInterfaces fallback)`);
            return best;
        }
    } catch (e) { }

    // 4. Absolute Fallback
    console.warn('📡 [SYSTEM] No interface detected. Defaulting to eth0');
    return 'eth0';
};

/**
 * MIGRATION: Consolidate Voice legacy files into voice-config.json
 */
const migrateVoiceConfig = () => {
    if (fs.existsSync(VOICE_CONFIG_FILE)) return;

    const legacyControlFile = path.join(APP_CONFIG.configDir, 'voice-control.json');
    const legacyServersFile = path.join(APP_CONFIG.configDir, 'voice-servers.txt');
    if (!fs.existsSync(legacyControlFile) && !fs.existsSync(legacyServersFile)) return;

    console.log('[SYSTEM] 📦 Migrating legacy Voice configuration to unified format...');

    let control: any = { enabled: false, max_simultaneous_calls: 3, sleep_between_calls: 5, interface: getInterface() };
    if (fs.existsSync(legacyControlFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(legacyControlFile, 'utf8'));
            control = { ...control, ...data };
        } catch (e) { console.error('Voice control migration failed', e); }
    }

    let servers: any[] = [];
    if (fs.existsSync(legacyServersFile)) {
        try {
            const content = fs.readFileSync(legacyServersFile, 'utf8');
            servers = content.split('\n')
                .map(line => line.trim())
                .filter(line => line && !line.startsWith('#'))
                .map(line => {
                    const parts = line.split('|');
                    return {
                        target: parts[0] || "",
                        codec: parts[1] || "G.711-ulaw",
                        weight: parseInt(parts[2]) || 50,
                        duration: parseInt(parts[3]) || 30
                    };
                });
        } catch (e) { console.error('Voice servers migration failed', e); }
    }

    let state = { counter: 0 };
    if (fs.existsSync(VOICE_COUNTER_FILE_LEGACY)) {
        try {
            state = JSON.parse(fs.readFileSync(VOICE_COUNTER_FILE_LEGACY, 'utf8'));
        } catch (e) { console.error('Voice counter migration failed', e); }
    }

    const unifiedConfig = { control, servers, state };
    fs.writeFileSync(VOICE_CONFIG_FILE, JSON.stringify(unifiedConfig, null, 2));
    console.log('[SYSTEM] ✅ Voice configuration consolidated.');

    // Cleanup old files
    try {
        if (fs.existsSync(legacyControlFile)) fs.renameSync(legacyControlFile, legacyControlFile + '.migrated');
        if (fs.existsSync(legacyServersFile)) fs.renameSync(legacyServersFile, legacyServersFile + '.migrated');
        if (fs.existsSync(VOICE_COUNTER_FILE_LEGACY)) fs.renameSync(VOICE_COUNTER_FILE_LEGACY, VOICE_COUNTER_FILE_LEGACY + '.migrated');
    } catch (e) { console.log('[SYSTEM] ⚠️ Failed to rename legacy voice files, but migration succeeded.'); }
};

/**
 * MIGRATION: Split security-tests.json into Config and History
 */
const migrateSecurityConfig = () => {
    const legacyFile = path.join(APP_CONFIG.configDir, 'security-tests.json');
    if (!fs.existsSync(legacyFile) || fs.existsSync(SECURITY_CONFIG_FILE)) return;

    console.log('[SYSTEM] 📦 Migrating legacy Security configuration and history...');
    try {
        const legacyData = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));

        // 1. Extract History
        const history = legacyData.test_history || [];
        if (history.length > 0) {
            const historyContent = history.map((h: any) => JSON.stringify(h)).join('\n') + '\n';
            fs.mkdirSync(path.dirname(SECURITY_HISTORY_FILE), { recursive: true });
            fs.appendFileSync(SECURITY_HISTORY_FILE, historyContent);
            console.log(`[SYSTEM] 🚚 Moved ${history.length} security history entries to logs.`);
        }

        // 2. Clean Config
        const cleanConfig = { ...legacyData };
        delete cleanConfig.test_history;

        fs.writeFileSync(SECURITY_CONFIG_FILE, JSON.stringify(cleanConfig, null, 2));
        console.log('[SYSTEM] ✅ Security configuration separation complete.');

        // Cleanup
        fs.renameSync(legacyFile, legacyFile + '.migrated');
    } catch (e) {
        console.error('Security migration failed', e);
    }
};

// Run Migrations
migrateVoiceConfig();
migrateSecurityConfig();

/**
 * MIGRATION: Consolidate Applications configuration
 */
const migrateApplicationsConfig = () => {
    // Force migration if file missing OR if it's an old version without categories
    if (fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
        try {
            const current = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8'));
            const hasCategories = current.applications && current.applications.some((app: any) => app.category && app.category !== 'Uncategorized');
            if (hasCategories) return;
            console.log('[SYSTEM] 🔄 Force-recreating Applications config to apply categorization...');
        } catch (e) {
            console.error('Failed to check existing applications config', e);
        }
    }

    const legacyAppsFile = path.join(APP_CONFIG.configDir, 'applications.txt');
    const legacyControlFile = path.join(APP_CONFIG.configDir, 'traffic-control.json');
    if (!fs.existsSync(legacyAppsFile) && !fs.existsSync(legacyControlFile)) return;

    console.log('[SYSTEM] 📦 Migrating legacy Applications configuration to unified format...');

    let control: any = { enabled: false, sleep_interval: 1.0 };
    if (fs.existsSync(legacyControlFile)) {
        try {
            control = JSON.parse(fs.readFileSync(legacyControlFile, 'utf8'));
        } catch (e) { console.error('Traffic control migration failed', e); }
    }

    let applications: any[] = [];
    let categoriesMigrated = false;

    // Source 1: Legacy Text File (includes comments/categories)
    if (fs.existsSync(legacyAppsFile)) {
        try {
            const content = fs.readFileSync(legacyAppsFile, 'utf8');
            const lines = content.split('\n');
            let currentCategory = 'Uncategorized';

            lines.forEach(line => {
                const trimmedLine = line.trim();
                if (!trimmedLine) return;

                if (trimmedLine.startsWith('#')) {
                    const comment = trimmedLine.substring(1).trim();
                    if (!comment.toLowerCase().startsWith('format:') && !comment.toLowerCase().startsWith('weight:')) {
                        currentCategory = comment;
                    }
                    return;
                }

                const parts = trimmedLine.split('|');
                if (parts.length >= 2) {
                    const [domain, weight, endpoint] = parts;
                    applications.push({
                        domain,
                        weight: parseInt(weight) || 50,
                        endpoint: endpoint || '/',
                        category: currentCategory
                    });
                }
            });
            categoriesMigrated = true;
        } catch (e) { console.error('Applications migration from .txt failed', e); }
    }

    // Source 2: Existing JSON (if it was string-based and Source 1 was missing)
    if (!categoriesMigrated && fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
        try {
            const current = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8'));
            if (current.applications && Array.isArray(current.applications)) {
                current.applications.forEach((app: any) => {
                    if (typeof app === 'string') {
                        const parts = app.split('|');
                        if (parts.length >= 2) {
                            applications.push({
                                domain: parts[0],
                                weight: parseInt(parts[1]) || 50,
                                endpoint: parts[2] || '/',
                                category: 'Uncategorized'
                            });
                        }
                    } else if (app && typeof app === 'object') {
                        applications.push({
                            domain: app.domain,
                            weight: app.weight || 50,
                            endpoint: app.endpoint || '/',
                            category: app.category || 'Uncategorized'
                        });
                    }
                });
            }
        } catch (e) { console.error('Applications modernization from JSON failed', e); }
    }

    const unifiedConfig = { control, applications };
    fs.writeFileSync(APPLICATIONS_CONFIG_FILE, JSON.stringify(unifiedConfig, null, 2));
    console.log('[SYSTEM] ✅ Applications configuration consolidated.');

    // Cleanup
    try {
        if (fs.existsSync(legacyAppsFile)) fs.renameSync(legacyAppsFile, legacyAppsFile + '.migrated');
        if (fs.existsSync(legacyControlFile)) fs.renameSync(legacyControlFile, legacyControlFile + '.migrated');
    } catch (e) { console.log('[SYSTEM] ⚠️ Failed to rename legacy application files.'); }
};

/**
 * MIGRATION: Consolidate VyOS configuration
 */
const migrateVyosConfig = () => {
    if (fs.existsSync(VYOS_CONFIG_FILE)) return;

    const legacyRoutersFile = path.join(APP_CONFIG.configDir, 'vyos-routers.json');
    const legacySequencesFile = path.join(APP_CONFIG.configDir, 'vyos-sequences.json');
    if (!fs.existsSync(legacyRoutersFile) && !fs.existsSync(legacySequencesFile)) return;

    console.log('[SYSTEM] 📦 Migrating VyOS configuration to unified format...');

    let routers: any[] = [];
    if (fs.existsSync(legacyRoutersFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(legacyRoutersFile, 'utf8'));
            routers = data.routers || [];
        } catch (e) { console.error('VyOS routers migration failed', e); }
    }

    let sequences: any[] = [];
    let runCounter = 0;
    if (fs.existsSync(legacySequencesFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(legacySequencesFile, 'utf8'));
            sequences = data.sequences || [];
            runCounter = data.runCounter || 0;
        } catch (e) { console.error('VyOS sequences migration failed', e); }
    }

    const unifiedConfig = { routers, sequences, runCounter };
    fs.writeFileSync(VYOS_CONFIG_FILE, JSON.stringify(unifiedConfig, null, 2));
    console.log('[SYSTEM] ✅ VyOS configuration consolidated.');

    // Cleanup
    try {
        if (fs.existsSync(legacyRoutersFile)) fs.renameSync(legacyRoutersFile, legacyRoutersFile + '.migrated');
        if (fs.existsSync(legacySequencesFile)) fs.renameSync(legacySequencesFile, legacySequencesFile + '.migrated');
    } catch (e) { console.log('[SYSTEM] ⚠️ Failed to rename legacy VyOS files.'); }
};

migrateApplicationsConfig();
migrateVyosConfig();

// --- Hot-Reload: Watch for interfaces.txt changes ---
const INTERFACES_FILE = path.join(APP_CONFIG.configDir, 'interfaces.txt');
if (fs.existsSync(INTERFACES_FILE)) {
    if (DEBUG) console.log(`📡 [WATCH] Monitoring ${INTERFACES_FILE} for changes...`);
    fs.watch(INTERFACES_FILE, (eventType) => {
        if (eventType === 'change') {
            if (DEBUG) console.log('📡 [WATCH] interfaces.txt changed, reloading...');
            const newIface = getInterface();
            iotManager.setInterface(newIface);
            // Also notify Voice if needed (though it reads on-demand usually)
        }
    });
}

const iotManager = new IoTManager(getInterface());
const vyosManager = new VyosManager(APP_CONFIG.configDir);
const vyosScheduler = new VyosScheduler(vyosManager, APP_CONFIG.configDir, APP_CONFIG.logDir);
const siteManager = new SiteManager(APP_CONFIG.configDir);
const discoveryManager = new DiscoveryManager(APP_CONFIG.configDir);

// START Site Detection Background Jobs
siteManager.runDetection().catch(e => log('SYSTEM', `Initial site detection failed: ${e.message}`, 'error'));
siteManager.startPeriodicRefresh(10); // Refresh every 10 minutes



const getNextBatchId = (): string => {
    try {
        if (!fs.existsSync(BATCH_COUNTER_FILE)) {
            fs.writeFileSync(BATCH_COUNTER_FILE, JSON.stringify({ counter: 0 }));
        }
        const data = JSON.parse(fs.readFileSync(BATCH_COUNTER_FILE, 'utf8'));
        let nextId = (data.counter || 0) + 1;
        if (nextId > 999) nextId = 1; // Rotate at 1000
        fs.writeFileSync(BATCH_COUNTER_FILE, JSON.stringify({ counter: nextId }));
        return nextId.toString().padStart(3, '0');
    } catch (e) {
        return Math.floor(Math.random() * 999).toString().padStart(3, '0');
    }
};

const getNextTestId = (): number => {
    try {
        if (!fs.existsSync(TEST_COUNTER_FILE)) {
            fs.writeFileSync(TEST_COUNTER_FILE, JSON.stringify({ counter: 0 }));
        }
        const data = JSON.parse(fs.readFileSync(TEST_COUNTER_FILE, 'utf8'));
        const nextId = (data.counter || 0) + 1;
        fs.writeFileSync(TEST_COUNTER_FILE, JSON.stringify({ counter: nextId }));
        return nextId;
    } catch (e) {
        console.error('Error managing test counter:', e);
        return Date.now(); // Fallback to timestamp
    }
};

let convergenceProcesses: Map<string, any> = new Map();
let convergencePPS: Map<string, number> = new Map();
// SRT process removed as unused

const getNextFailoverTestId = (): string => {
    try {
        if (!fs.existsSync(CONVERGENCE_COUNTER_FILE)) {
            fs.writeFileSync(CONVERGENCE_COUNTER_FILE, JSON.stringify({ counter: 0 }));
        }
        const data = JSON.parse(fs.readFileSync(CONVERGENCE_COUNTER_FILE, 'utf8'));
        const nextId = ((data.counter || 0) + 1) % 10000;
        fs.writeFileSync(CONVERGENCE_COUNTER_FILE, JSON.stringify({ counter: nextId }));
        return `CONV-${nextId.toString().padStart(4, '0')}`;
    } catch (e) {
        return `CONV-${Date.now()}`;
    }
};

// Resource Monitoring State
// State for stats tracking (bitrate and CPU percentage)
interface ContainerStats {
    prevNetwork: { rx: number, tx: number, time: number } | null;
    prevCpu: { usage: number, system: number, time: number } | null;
    currentBitrate: { rx_low: number, tx_low: number, rx_mbps: string, tx_mbps: string };
    currentCpuPercent: string;
}

const containerStatsMap = new Map<string, ContainerStats>();
const monitoredContainers = ['sdwan-web-ui', 'sdwan-traffic-gen', 'sdwan-voice-gen'];

// Initialize map
monitoredContainers.forEach(name => {
    containerStatsMap.set(name, {
        prevNetwork: null,
        prevCpu: null,
        currentBitrate: { rx_low: 0, tx_low: 0, rx_mbps: '0', tx_mbps: '0' },
        currentCpuPercent: '0.0'
    });
});

// State tracking for logs reduction
const lastConnectivityStatusMap = new Map<string, string>();
const lastConnectivityScoreMap = new Map<string, number>();
const lastConnectivityLogTimeMap = new Map<string, number>();

let lastLoggedVersion: string | null = null;
let lastVersionLogTime: number = 0;

// Health check cache
let lastHealthCheckTime = 0;
let cachedHealthResult: any = null;
const HEALTH_CHECK_CACHE_MS = 5000;

// GitHub fetch deduplication
let githubFetchErrorLogged = false;

// Test Logger - Dedicated log file for test execution with rotation
const TEST_LOG_FILE = path.join(APP_CONFIG.logDir, 'test-execution.log');
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB

const logTest = (...args: any[]) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    try {
        // Check file size and rotate if needed
        if (fs.existsSync(TEST_LOG_FILE)) {
            const stats = fs.statSync(TEST_LOG_FILE);
            if (stats.size > MAX_LOG_SIZE) {
                const rotatedFile = `${TEST_LOG_FILE}.${Date.now()}`;
                fs.renameSync(TEST_LOG_FILE, rotatedFile);
                console.log(`[TEST-LOG] Rotated log file to: ${rotatedFile}`);
            }
        }

        // Append to log file
        fs.appendFileSync(TEST_LOG_FILE, logLine);

        // Also log to console
        console.log(message);
    } catch (e) {
        console.error('Error writing to test log:', e);
        console.log(message); // Fallback to console only
    }
};

/**
 * Log Healing: Cleanup test-results.jsonl from non-JSON lines on startup
 */
const healLogFiles = () => {
    const resultsFile = path.join(APP_CONFIG.logDir, 'test-results.jsonl');
    if (!fs.existsSync(resultsFile)) return;

    try {
        if (DEBUG) console.log('[SYSTEM] 🧹 Healing log files...');
        const content = fs.readFileSync(resultsFile, 'utf8');
        const lines = content.split('\n');
        const validLines = lines.filter(line => {
            if (!line.trim()) return false;
            try {
                JSON.parse(line);
                return true;
            } catch (e) {
                return false;
            }
        });

        if (validLines.length !== lines.filter(l => l.trim()).length) {
            if (DEBUG) console.log(`[SYSTEM] ✨ Removed ${lines.filter(l => l.trim()).length - validLines.length} invalid lines from test-results.jsonl`);
            fs.writeFileSync(resultsFile, validLines.join('\n') + '\n', 'utf8');
        } else {
            if (DEBUG) console.log('[SYSTEM] ✅ Log files are healthy.');
        }
    } catch (e: any) {
        console.error('[SYSTEM] Failed to heal log files:', e.message);
    }
};


// Platform Detection & DNS Command Availability
const PLATFORM = os.platform(); // 'linux', 'darwin', 'win32'
const availableCommands: { [key: string]: boolean } = {};

// Check if a command is available
const checkCommand = async (command: string): Promise<boolean> => {
    try {
        const execPromise = promisify(exec);
        await execPromise(command);
        return true;
    } catch {
        return false;
    }
};

// Initialize available commands on startup
const initializeCommands = async () => {
    if (DEBUG) console.log(`[PLATFORM] Detected platform: ${PLATFORM}`);

    // Check DNS command availability
    availableCommands.getent = await checkCommand('getent --version 2>/dev/null');
    availableCommands.dscacheutil = await checkCommand('dscacheutil -h 2>/dev/null');
    availableCommands.dig = await checkCommand('dig -v 2>/dev/null');
    availableCommands.nslookup = await checkCommand('nslookup -version 2>/dev/null || nslookup localhost 2>/dev/null');
    availableCommands.curl = await checkCommand('curl --version 2>/dev/null');
    availableCommands.ping = await checkCommand('ping -V 2>/dev/null || ping -h 2>/dev/null');
    availableCommands.nc = await checkCommand('nc -h 2>/dev/null || nc -v localhost 1 2>/dev/null');
    availableCommands.iperf3 = await checkCommand('iperf3 -v 2>/dev/null');

    if (DEBUG) console.log('[PLATFORM] Available commands:', availableCommands);

    if (!availableCommands.ping) console.warn('⚠️  WARNING: "ping" command not found. ICMP tests will fail.');
    if (!availableCommands.nc) console.warn('⚠️  WARNING: "nc" (netcat) command not found. TCP port tests will fail.');
    if (!availableCommands.dig && !availableCommands.nslookup) console.warn('⚠️  WARNING: No DNS tool found (dig/nslookup). DNS resolution might fail.');

    // Start iperf3 server if available
    if (availableCommands.iperf3) {
        startIperfServer();
    }
};

let iperfServerProcess: any = null;
const startIperfServer = () => {
    try {
        if (DEBUG) log('IPERF', 'Starting iperf3 server on port 5201...', 'debug');
        const iperfServer = spawn('iperf3', ['-s', '-p', '5201']);

        iperfServer.on('error', (err: any) => {
            log('IPERF', `Server failed to start: ${err.message}`, 'error');
        });

        iperfServer.stdout.on('data', (data: any) => {
            // Optional: log or ignore
        });

        process.on('exit', () => iperfServerProcess?.kill());
    } catch (e: any) {
        log('IPERF', `Error starting server: ${e.message}`, 'error');
    }
};

// Get the best DNS command for the current platform
// For security tests, we prefer tools that bypass OS caching and provide more detail (nslookup/dig)
const getDnsCommand = (domain: string): { command: string; type: string } => {
    // Priority 1: nslookup (Universal and provides CNAME info which is vital for sinkhole detection)
    // Adding timeout for robustness
    if (availableCommands.nslookup) {
        const cmd = PLATFORM === 'win32' ? `nslookup -timeout=2 ${domain}` : `nslookup -timeout=2 ${domain}`;
        return { command: cmd, type: 'nslookup' };
    }

    // Priority 2: dig (Linux/Mac standard for deep inspection)
    if (availableCommands.dig) {
        return { command: `dig ${domain} +short +time=2 +tries=1`, type: 'dig' };
    }

    // Fallbacks for specific platforms if technical tools missing
    if (PLATFORM === 'linux' && availableCommands.getent) {
        return { command: `timeout 2 getent ahosts ${domain}`, type: 'getent' };
    }

    if (PLATFORM === 'darwin' && availableCommands.dscacheutil) {
        return { command: `dscacheutil -q host -a name ${domain}`, type: 'dscacheutil' };
    }

    // Ultimate fallback
    return { command: `nslookup -timeout=2 ${domain}`, type: 'nslookup' };
};

// Parse DNS command output based on command type
const parseDnsOutput = (output: string, type: string): string | null => {
    if (!output || output.trim() === '') return null;

    if (type === 'getent') {
        // Format: "198.135.184.22  STREAM malware.wicar.org"
        const match = output.match(/^(\d+\.\d+\.\d+\.\d+)/m);
        return match ? match[1] : null;
    }

    if (type === 'dscacheutil') {
        // Format: "ip_address: 198.135.184.22"
        const match = output.match(/ip_address:\s*(\d+\.\d+\.\d+\.\d+)/);
        return match ? match[1] : null;
    }

    if (type === 'dig') {
        // Format: "198.135.184.22" (just the IP)
        const match = output.match(/^(\d+\.\d+\.\d+\.\d+)/m);
        return match ? match[1] : null;
    }

    if (type === 'nslookup') {
        // Ignore the "Server" and first "Address" (the resolver)
        // We look for the block AFTER "Non-authoritative answer" or simply the LAST Address entry
        const lines = output.split('\n');
        let answerFound = false;
        for (const line of lines) {
            if (line.includes('Non-authoritative') || line.includes('Name:')) {
                answerFound = true;
            }
            if (answerFound) {
                const match = line.match(/Address(?:es)?:\s+((?:\d{1,3}\.){3}\d{1,3})/);
                if (match) return match[1];
            }
        }
        // Fallback to the very last address found in the whole output
        const allMatches = Array.from(output.matchAll(/Address(?:es)?:\s+((?:\d{1,3}\.){3}\d{1,3})/g));
        if (allMatches.length > 0) {
            return allMatches[allMatches.length - 1][1];
        }
        return null;
    }

    return null;
};


const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

// Setup IoT real-time logs via Socket.io
io.on('connection', (socket) => {
    socket.on('join-device-logs', (deviceId) => {
        socket.join(`logs:${deviceId}`);
        // Send initial cache
        const status = iotManager.getDeviceStatus(deviceId);
        if (status && status.logs) {
            socket.emit('initial-logs', { device_id: deviceId, logs: status.logs });
        }
    });

    socket.on('leave-device-logs', (deviceId) => {
        socket.leave(`logs:${deviceId}`);
    });
});

iotManager.on('device:log', (log) => {
    io.to(`logs:${log.device_id}`).emit('device:log', log);
});

const PORT = parseInt(process.env.PORT || '8080'); // Unified to 8080

const SECRET_KEY = process.env.JWT_SECRET || 'super-secret-key-change-this';
const USERS_FILE = path.join(APP_CONFIG.configDir, 'users.json');
const DEBUG_API = process.env.DEBUG_API === 'true';

app.use(cors());
app.use(express.json());

// Global request logger - logs ALL incoming requests (only if DEBUG_API=true)
if (DEBUG_API) {
    app.use((req, res, next) => {
        console.log(`[REQUEST] ${req.method} ${req.path}`, {
            body: req.body,
            query: req.query,
            headers: {
                'content-type': req.headers['content-type'],
                'authorization': req.headers['authorization'] ? 'Bearer ***' : 'none'
            }
        });
        next();
    });
}

// --- Authentication Middleware ---
const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    // Allow token in query string for SSE (EventSource)
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;

    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err: any, user: any) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

const extractUserMiddleware = authenticateToken; // Alias for now, or we can look into optional auth later if needed.


// --- Auth Helpers ---
const getUsers = (): any[] => {
    if (!fs.existsSync(USERS_FILE)) return [];
    try {
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch { return []; }
};

const saveUsers = (users: any[]) => {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

// --- Initialize Default Configuration Files ---
const initializeDefaultConfigs = () => {
    const configDir = APP_CONFIG.configDir;
    const interfacesFile = path.join(configDir, 'interfaces.txt');
    // Create default applications-config.json if it doesn't exist
    if (!fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
        const defaultApps = [
            { domain: "outlook.office365.com", weight: 100, endpoint: "/", category: "Microsoft 365 Suite" },
            { domain: "teams.microsoft.com", weight: 95, endpoint: "/api/mt/emea/beta/users/", category: "Microsoft 365 Suite" },
            { domain: "login.microsoftonline.com", weight: 90, endpoint: "/", category: "Microsoft 365 Suite" },
            { domain: "graph.microsoft.com", weight: 85, endpoint: "/v1.0/me", category: "Microsoft 365 Suite" },
            { domain: "onedrive.live.com", weight: 80, endpoint: "/", category: "Microsoft 365 Suite" },
            { domain: "sharepoint.com", weight: 75, endpoint: "/", category: "Microsoft 365 Suite" },
            { domain: "mail.google.com", weight: 90, endpoint: "/mail/", category: "Google Workspace" },
            { domain: "drive.google.com", weight: 85, endpoint: "/", category: "Google Workspace" },
            { domain: "docs.google.com", weight: 80, endpoint: "/document/", category: "Google Workspace" },
            { domain: "meet.google.com", weight: 75, endpoint: "/", category: "Google Workspace" },
            { domain: "calendar.google.com", weight: 70, endpoint: "/", category: "Google Workspace" },
            { domain: "zoom.us", weight: 90, endpoint: "/", category: "Communication & Collaboration" },
            { domain: "slack.com", weight: 85, endpoint: "/api/api.test", category: "Communication & Collaboration" },
            { domain: "webex.com", weight: 70, endpoint: "/", category: "Communication & Collaboration" },
            { domain: "discord.com", weight: 40, endpoint: "/api/v9/gateway", category: "Communication & Collaboration" },
            { domain: "salesforce.com", weight: 80, endpoint: "/", category: "CRM & Sales" },
            { domain: "hubspot.com", weight: 60, endpoint: "/", category: "CRM & Sales" },
            { domain: "dynamics.microsoft.com", weight: 55, endpoint: "/", category: "CRM & Sales" },
            { domain: "monday.com", weight: 65, endpoint: "/", category: "Project Management" },
            { domain: "asana.com", weight: 60, endpoint: "/", category: "Project Management" },
            { domain: "trello.com", weight: 55, endpoint: "/", category: "Project Management" },
            { domain: "jira.atlassian.com", weight: 70, endpoint: "/", category: "Project Management" },
            { domain: "confluence.atlassian.com", weight: 65, endpoint: "/", category: "Project Management" },
            { domain: "dropbox.com", weight: 75, endpoint: "/", category: "Cloud Storage & File Sharing" },
            { domain: "box.com", weight: 60, endpoint: "/", category: "Cloud Storage & File Sharing" },
            { domain: "wetransfer.com", weight: 45, endpoint: "/", category: "Cloud Storage & File Sharing" },
            { domain: "github.com", weight: 75, endpoint: "/", category: "Development & DevOps" },
            { domain: "gitlab.com", weight: 55, endpoint: "/", category: "Development & DevOps" },
            { domain: "bitbucket.org", weight: 45, endpoint: "/", category: "Development & DevOps" },
            { domain: "stackoverflow.com", weight: 50, endpoint: "/", category: "Development & DevOps" },
            { domain: "portal.azure.com", weight: 70, endpoint: "/", category: "Cloud Providers" },
            { domain: "console.aws.amazon.com", weight: 70, endpoint: "/", category: "Cloud Providers" },
            { domain: "console.cloud.google.com", weight: 65, endpoint: "/", category: "Cloud Providers" },
            { domain: "tableau.com", weight: 50, endpoint: "/", category: "Business Intelligence" },
            { domain: "powerbi.microsoft.com", weight: 55, endpoint: "/", category: "Business Intelligence" },
            { domain: "looker.com", weight: 40, endpoint: "/", category: "Business Intelligence" },
            { domain: "workday.com", weight: 55, endpoint: "/", category: "HR & Productivity" },
            { domain: "bamboohr.com", weight: 40, endpoint: "/", category: "HR & Productivity" },
            { domain: "zenefits.com", weight: 35, endpoint: "/", category: "HR & Productivity" },
            { domain: "adp.com", weight: 45, endpoint: "/", category: "HR & Productivity" },
            { domain: "linkedin.com", weight: 60, endpoint: "/", category: "Marketing & Social" },
            { domain: "twitter.com", weight: 50, endpoint: "/robots.txt", category: "Marketing & Social" },
            { domain: "facebook.com", weight: 55, endpoint: "/robots.txt", category: "Marketing & Social" },
            { domain: "instagram.com", weight: 45, endpoint: "/robots.txt", category: "Marketing & Social" },
            { domain: "figma.com", weight: 55, endpoint: "/", category: "Design & Creative" },
            { domain: "canva.com", weight: 50, endpoint: "/", category: "Design & Creative" },
            { domain: "adobe.com", weight: 45, endpoint: "/", category: "Design & Creative" },
            { domain: "zendesk.com", weight: 60, endpoint: "/", category: "Customer Support" },
            { domain: "intercom.com", weight: 50, endpoint: "/", category: "Customer Support" },
            { domain: "freshdesk.com", weight: 40, endpoint: "/", category: "Customer Support" },
            { domain: "quickbooks.intuit.com", weight: 50, endpoint: "/", category: "Finance & Accounting" },
            { domain: "expensify.com", weight: 40, endpoint: "/", category: "Finance & Accounting" },
            { domain: "stripe.com", weight: 45, endpoint: "/", category: "Finance & Accounting" },
            { domain: "okta.com", weight: 55, endpoint: "/", category: "Security & IT Tools" },
            { domain: "duo.com", weight: 45, endpoint: "/", category: "Security & IT Tools" },
            { domain: "1password.com", weight: 40, endpoint: "/", category: "Security & IT Tools" },
            { domain: "lastpass.com", weight: 35, endpoint: "/", category: "Security & IT Tools" },
            { domain: "youtube.com", weight: 65, endpoint: "/feed/trending", category: "Video & Media" },
            { domain: "vimeo.com", weight: 40, endpoint: "/", category: "Video & Media" },
            { domain: "netflix.com", weight: 30, endpoint: "/robots.txt", category: "Video & Media" },
            { domain: "shopify.com", weight: 50, endpoint: "/", category: "E-commerce" },
            { domain: "amazon.com", weight: 60, endpoint: "/robots.txt", category: "E-commerce" },
            { domain: "ebay.com", weight: 35, endpoint: "/robots.txt", category: "E-commerce" },
            { domain: "notion.so", weight: 65, endpoint: "/", category: "Popular SaaS" },
            { domain: "airtable.com", weight: 50, endpoint: "/", category: "Popular SaaS" },
            { domain: "miro.com", weight: 55, endpoint: "/", category: "Popular SaaS" },
            { domain: "docusign.com", weight: 50, endpoint: "/", category: "Popular SaaS" }
        ];

        const config = {
            control: {
                enabled: process.env.AUTO_START_TRAFFIC === 'true',
                sleep_interval: parseFloat(process.env.SLEEP_BETWEEN_REQUESTS || '1.0')
            },
            applications: defaultApps
        };

        fs.writeFileSync(APPLICATIONS_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
        console.log(`Created default applications-config.json with ${defaultApps.length} applications`);
    }

    // ✅ Unified Initialization: Use the same logic as the runtime
    if (!fs.existsSync(interfacesFile)) {
        console.log('🔍 No interfaces.txt found, creating from auto-detection...');
        const defaultIface = getInterface();
        fs.writeFileSync(interfacesFile, defaultIface, 'utf8');
        console.log(`✅ [INIT] Auto-configured interface: ${defaultIface}`);
    } else {
        const content = fs.readFileSync(interfacesFile, 'utf8').trim();
        const firstLine = fs.readFileSync(interfacesFile, 'utf8').split('\n')[0].trim(); // Changed ifacePath to interfacesFile
        log('INIT', `Found existing interfaces.txt: ${firstLine}`);
    }

    // Traffic Control is now part of applications-config.json

    // Initialize IoT devices from default template if it exists
    if (!fs.existsSync(IOT_DEVICES_FILE)) {
        // Try both ../iot (dev) and ./iot (docker)
        let defaultIoTFile = path.resolve(path.join(__dirname, '../iot/iot_devices.json'));
        if (!fs.existsSync(defaultIoTFile)) {
            defaultIoTFile = path.resolve(path.join(__dirname, './iot/iot_devices.json'));
        }

        if (fs.existsSync(defaultIoTFile)) {
            try {
                const defaultData = JSON.parse(fs.readFileSync(defaultIoTFile, 'utf8'));
                // Save the full object (network + devices)
                fs.writeFileSync(IOT_DEVICES_FILE, JSON.stringify(defaultData, null, 2), 'utf8');
                console.log('✅ Initialized IoT devices from template');
            } catch (e) {
                console.error('Error initializing IoT devices template:', e);
                fs.writeFileSync(IOT_DEVICES_FILE, JSON.stringify({ network: { interface: 'eth0' }, devices: [] }, null, 2), 'utf8');
            }
        } else {
            fs.writeFileSync(IOT_DEVICES_FILE, JSON.stringify({ network: { interface: 'eth0' }, devices: [] }, null, 2), 'utf8');
        }
    }
};

// Initialize Admin if no users
if (getUsers().length === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin', salt);
    saveUsers([{ username: 'admin', passwordHash: hash }]);
    console.log('Created default admin user (admin/admin)');
}

// Initialize default config files
initializeDefaultConfigs();

// --- IoT Helpers ---
const getIoTConfig = (): { devices: IoTDeviceConfig[], network?: any } => {
    try {
        if (!fs.existsSync(IOT_DEVICES_FILE)) {
            log('IOT', `Config file NOT found: ${IOT_DEVICES_FILE}`, 'warn');
            return { devices: [] }; // Ensure consistent return type
        }
        const content = fs.readFileSync(IOT_DEVICES_FILE, 'utf8');
        if (process.env.DEBUG_IOT === 'true') {
            log('IOT', `Read ${content.length} bytes from ${IOT_DEVICES_FILE}`, 'debug');
        }
        const data = JSON.parse(content);

        // Handle legacy format (either flat array or object with network block)
        if (Array.isArray(data)) {
            return { devices: data };
        }

        return { devices: data.devices || [] };
    } catch (e: any) {
        log('IOT', `Failed to parse ${IOT_DEVICES_FILE}: ${e.message}`, 'error');
        return { devices: [] };
    }
};

const getIoTDevices = (): IoTDeviceConfig[] => {
    return getIoTConfig().devices;
};

const saveIoTConfig = (config: { devices: IoTDeviceConfig[], network?: any }) => {
    // We strictly ONLY save devices. No more network block.
    fs.writeFileSync(IOT_DEVICES_FILE, JSON.stringify({ devices: config.devices }, null, 2));

    // Auto-sync manager with current "One Truth" interface
    iotManager.setInterface(getInterface());
};

const saveIoTDevices = (devices: IoTDeviceConfig[]) => {
    const config = getIoTConfig();
    config.devices = devices;
    saveIoTConfig(config);
};

// Sync IoT manager interface with the primary interface
try {
    const primaryIface = getInterface();
    console.log(`[IOT-INIT] Syncing manager with primary interface: ${primaryIface}`);
    iotManager.setInterface(primaryIface);
} catch (e) {
    console.warn('[IOT-INIT] Failed to sync interface on startup', e);
}

// Global interface for other services
const GLOBAL_INTERFACE = getInterface();

// Sync Voice interface with unified config if needed
try {
    if (fs.existsSync(VOICE_CONFIG_FILE)) {
        const config = JSON.parse(fs.readFileSync(VOICE_CONFIG_FILE, 'utf8'));
        if (config.control) {
            if (!config.control.interface || config.control.interface === 'eth0') {
                config.control.interface = GLOBAL_INTERFACE;
                fs.writeFileSync(VOICE_CONFIG_FILE, JSON.stringify(config, null, 2));
                console.log(`[VOICE-INIT] Synced interface to: ${GLOBAL_INTERFACE}`);
            }
        }
    }
} catch (e) {
    console.warn('[VOICE-INIT] Failed to sync voice interface', e);
}

// --- Auth Endpoints ---

app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const users = getUsers();
    const user = users.find((u: any) => u.username === username);

    if (user && bcrypt.compareSync(password, user.passwordHash)) {
        const token = jwt.sign({ username: user.username }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ token, username: user.username });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.post('/api/auth/change-password', authenticateToken, (req: any, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 5) {
        return res.status(400).json({ error: 'Password too short' });
    }

    const users = getUsers();
    const userIndex = users.findIndex((u: any) => u.username === req.user.username);

    if (userIndex !== -1) {
        const salt = bcrypt.genSaltSync(10);
        users[userIndex].passwordHash = bcrypt.hashSync(newPassword, salt);
        saveUsers(users);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

app.post('/api/auth/users', authenticateToken, (req: any, res) => {
    // Only admin can add users
    if (req.user.username !== 'admin') {
        return res.status(403).json({ error: 'Only admin can add users' });
    }

    const { username, password } = req.body;
    if (!username || !password || password.length < 5) {
        return res.status(400).json({ error: 'Invalid username or password (min 5 chars)' });
    }

    const users = getUsers();
    if (users.find((u: any) => u.username === username)) {
        return res.status(400).json({ error: 'User already exists' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    users.push({ username, passwordHash });
    saveUsers(users);
    res.json({ success: true, message: 'User created' });
});

// --- VyOS Endpoints ---

app.get('/api/vyos/routers', authenticateToken, (req, res) => {
    res.json(vyosManager.getRouters());
});

app.post('/api/vyos/routers/discover', authenticateToken, async (req, res) => {
    const { host, apiKey, location } = req.body;
    if (!host || !apiKey) return res.status(400).json({ error: 'Host and API Key required' });

    console.log(`[API] VyOS Discovery Request: host=${host}, apiKey=${apiKey.substring(0, 4)}***`);
    try {
        // 1. Discover router info
        const info = await vyosManager.discoverRouter(host, apiKey);

        // 2. Slugify hostname to create router ID
        const routerId = vyosManager.slugify(info.hostname);

        // 3. Check duplicate
        if (vyosManager.getRouter(routerId)) {
            return res.status(400).json({ success: false, error: 'Router already exists' });
        }

        // 4. Create router object
        const newRouter = {
            id: routerId,
            name: info.hostname,
            host: host,
            apiKey: apiKey,
            version: info.version,
            location: location || undefined,
            interfaces: info.interfaces,
            enabled: true,
            status: 'online',
            lastSeen: Date.now()
        };

        // 5. Save
        vyosManager.saveRouter(newRouter as any);

        res.json({ success: true, router: newRouter });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Create / discover (generic save)
app.post('/api/vyos/routers', authenticateToken, (req, res) => {
    const router = req.body;
    if (!router.id || !router.host) return res.status(400).json({ error: 'Invalid router data' });
    vyosManager.saveRouter(router);
    res.json({ success: true });
});

// Update existing router
app.post('/api/vyos/routers/:id', authenticateToken, (req, res) => {
    const router = req.body;
    if (!router.id || !router.host) return res.status(400).json({ error: 'Invalid router data' });
    vyosManager.saveRouter(router);
    res.json({ success: true });
});

app.delete('/api/vyos/routers/:id', authenticateToken, (req, res) => {
    const routerId = req.params.id;

    // Safety check: is this router used in any sequence?
    const sequences = vyosScheduler.getSequences();
    const isUsed = sequences.some(s => s.actions.some(a => a.router_id === routerId));

    if (isUsed) {
        return res.status(400).json({
            error: 'Cannot delete router: it is still referenced in one or more mission sequences. Delete or update the sequences first.'
        });
    }

    vyosManager.deleteRouter(routerId);
    res.json({ success: true });
});

app.post('/api/vyos/routers/refresh/:id', authenticateToken, async (req, res) => {
    try {
        const updatedRouter = await vyosManager.refreshRouter(req.params.id);
        res.json({ success: true, router: updatedRouter });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/vyos/routers/test/:id', authenticateToken, async (req, res) => {
    try {
        const isOnline = await vyosManager.testConnection(req.params.id);
        if (isOnline) {
            res.json({ success: true, status: 'online' });
        } else {
            res.status(500).json({ success: false, status: 'offline' });
        }
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- VyOS Sequence Endpoints ---

app.get('/api/vyos/sequences', authenticateToken, (req, res) => {
    res.json(vyosScheduler.getSequences());
});

app.post('/api/vyos/sequences', authenticateToken, (req, res) => {
    const sequence = req.body;
    if (!sequence.id || !sequence.name || !Array.isArray(sequence.actions)) {
        return res.status(400).json({ error: 'Invalid sequence data' });
    }
    vyosScheduler.saveSequence(sequence);
    res.json({ success: true });
});

app.delete('/api/vyos/sequences/:id', authenticateToken, (req, res) => {
    vyosScheduler.deleteSequence(req.params.id);
    res.json({ success: true });
});

app.post('/api/vyos/sequences/run/:id', authenticateToken, async (req, res) => {
    try {
        await vyosScheduler.runSequenceManually(req.params.id);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/vyos/sequences/step/:id', authenticateToken, async (req, res) => {
    try {
        const { stepIndex } = req.body;
        await vyosScheduler.runSequenceStep(req.params.id, parseInt(stepIndex));
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/vyos/sequences/pause/:id', authenticateToken, async (req, res) => {
    try {
        vyosScheduler.pauseSequence(req.params.id);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/vyos/sequences/resume/:id', authenticateToken, async (req, res) => {
    try {
        vyosScheduler.resumeSequence(req.params.id);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/vyos/sequences/stop/:id', authenticateToken, async (req, res) => {
    try {
        vyosScheduler.stopSequence(req.params.id);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/vyos/history', authenticateToken, (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(vyosScheduler.getHistory(limit));
});

// VyOS Unified Configuration Management
app.get('/api/vyos/config/export', authenticateToken, (req, res) => {
    try {
        const config = vyosManager.getFullConfig();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="vyos-config.json"');
        res.send(JSON.stringify(config, null, 2));
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/vyos/config/import', authenticateToken, (req, res) => {
    try {
        const config = req.body;
        vyosManager.setFullConfig(config);
        vyosScheduler.reload();
        res.json({ success: true, message: 'VyOS configuration imported successfully' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/vyos/config/reset', authenticateToken, (req, res) => {
    try {
        vyosManager.resetConfig();
        res.json({ success: true, message: 'VyOS configuration reset successfully' });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// API: Get UI Configuration (Public endpoint)
app.get('/api/features', (req, res) => {
    res.json({
        xfr_enabled: true,
        xfr_targets: XFR_QUICK_TARGETS,
        targets: targetsManager.getMergedTargets()   // shared targets registry
    });
});

// --- XFR Speedtest Endpoints ---

app.post('/api/tests/xfr', authenticateToken, (req, res) => {
    log('API', `[XFR] Incoming POST request: ${JSON.stringify(req.body)}`);
    const { mode, target, protocol, direction, duration_sec, bitrate, parallel_streams, psk } = req.body;

    if (!mode || !target || !target.host || !target.port) {
        return res.status(400).json({ error: 'mode and target (host/port) are required' });
    }

    if (mode === 'custom') {
        if (protocol && !['tcp', 'udp', 'quic'].includes(protocol)) {
            return res.status(400).json({ error: 'protocol must be tcp, udp, or quic' });
        }
        if (duration_sec !== undefined && duration_sec <= 0) {
            return res.status(400).json({ error: 'duration_sec must be > 0' });
        }
        if (parallel_streams !== undefined && parallel_streams < 1) {
            return res.status(400).json({ error: 'parallel_streams must be >= 1' });
        }
    }

    const id = xfrManager.createJob({
        mode,
        host: target.host,
        port: target.port,
        psk,
        protocol: protocol || (mode === 'default' ? 'tcp' : undefined),
        direction: direction || (mode === 'default' ? 'client-to-server' : undefined),
        duration_sec: duration_sec || (mode === 'default' ? 10 : undefined),
        bitrate: bitrate || (mode === 'default' ? '200M' : undefined),
        parallel_streams: parallel_streams || (mode === 'default' ? 4 : undefined),
    });

    log('API', `[XFR] Created job ${id}. Starting execution...`);
    xfrManager.startJob(id);

    log('API', `[XFR] Sending response for ${id}`);
    res.json({ id, status: 'queued' });
});

app.get('/api/tests/xfr', authenticateToken, (req, res) => {
    const jobs = xfrManager.getAllJobs().map(j => ({
        id: j.id,
        sequence_id: j.sequence_id,
        status: j.status,
        started_at: j.started_at,
        finished_at: j.finished_at,
        params: j.params,
        summary: j.summary,
        error: j.error
    }));
    res.json(jobs);
});

app.get('/api/tests/xfr/:id', authenticateToken, (req, res) => {

    const job = xfrManager.getJob(req.params.id);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
        id: job.id,
        status: job.status,
        started_at: job.started_at,
        finished_at: job.finished_at,
        params: job.params,
        results: job.status === 'completed' || job.status === 'failed' ? {
            summary: job.summary,
            intervals: job.intervals
        } : null,
        error: job.error
    });
});

app.get('/api/tests/xfr/:id/stream', authenticateToken, (req, res) => {

    const job = xfrManager.getJob(req.params.id);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Prevent proxy buffering
    res.flushHeaders();

    const listener = (event: any) => {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
    };

    xfrManager.addListener(job.id, listener);

    req.on('close', () => {
        xfrManager.removeListener(job.id, listener);
    });
});

// API: Get UI Configuration (Public endpoint)
app.get('/api/config/ui', (req, res) => {
    res.json({
        refreshInterval: parseInt(process.env.DASHBOARD_REFRESH_MS || '1000')
    });
});

// API: Get Site Information (Prisma SD-WAN)
app.get('/api/siteinfo', authenticateToken, (req, res) => {
    const info = siteManager.getSiteInfo();
    const hasCredentials = !!process.env.PRISMA_SDWAN_CLIENT_ID && !!process.env.PRISMA_SDWAN_CLIENT_SECRET;
    res.json({ ...info, hasCredentials });
});

// API: Refresh Site Information (Prisma SD-WAN)
app.post('/api/siteinfo/refresh', authenticateToken, async (req, res) => {
    try {
        const result = await siteManager.runDetection();
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Topology API ---
let topologyCache: { data: any, timestamp: number } | null = null;
const TOPO_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.get('/api/topology', authenticateToken, async (req, res) => {
    const now = Date.now();
    const force = req.query.force === 'true';

    if (!force && topologyCache && (now - topologyCache.timestamp < TOPO_CACHE_TTL)) {
        dbg(`[TOPO] Returning cached topology (${Math.round((now - topologyCache.timestamp) / 1000)}s old)`);
        return res.json(topologyCache.data);
    }

    try {
        const scriptPath = path.join(PROJECT_ROOT, 'engines', 'getflow.py');
        const enginesDir = path.join(PROJECT_ROOT, 'engines');

        // Check Env
        const hasId = !!process.env.PRISMA_SDWAN_CLIENT_ID;
        const hasSecret = !!process.env.PRISMA_SDWAN_CLIENT_SECRET;
        const hasTsg = !!process.env.PRISMA_SDWAN_TSG_ID;
        log('TOPO', `Spawn Env Check - ID: ${hasId}, Secret: ${hasSecret}, TSG: ${hasTsg}`);

        log('TOPO', `Spawning ${PYTHON_PATH} ${scriptPath} --build-topology --json`);

        const args = [scriptPath, '--build-topology', '--json'];
        const proc = spawn(PYTHON_PATH, args, {
            cwd: enginesDir,
            timeout: 120_000,
            env: { ...process.env, PYTHONUNBUFFERED: '1' }
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => {
            stdout += d.toString();
        });
        proc.stderr.on('data', (d) => {
            stderr += d.toString();
            console.error(`[TOPO-STDERR] ${d.toString().trim()}`);
        });

        proc.on('close', (code) => {
            if (code === 0) {
                try {
                    const data = JSON.parse(stdout);
                    topologyCache = { data, timestamp: Date.now() };
                    res.json(data);
                } catch (e) {
                    console.error('[TOPO] Failed to parse JSON:', e, 'STDOUT length:', stdout.length);
                    res.status(500).json({ error: 'Failed to parse topology data' });
                }
            } else {
                console.error(`[TOPO] getflow.py exited with code ${code}. Stderr: ${stderr}`);
                res.status(500).json({
                    error: 'Failed to build topology',
                    details: stderr || 'Check server logs for silent failure'
                });
            }
        });

        proc.on('error', (err) => {
            console.error('[TOPO] Failed to spawn process:', err);
            res.status(500).json({ error: 'Internal server error spawning topology builder' });
        });

    } catch (err: any) {
        console.error('[TOPO] Exception:', err);
        res.status(500).json({ error: err.message });
    }
});

// API: Get Version (Public endpoint)
app.get('/api/version', (req, res) => {

    try {
        const versionFile = path.join(__dirname, 'VERSION');
        if (fs.existsSync(versionFile)) {
            const version = fs.readFileSync(versionFile, 'utf8').trim();
            res.json({ version });
        } else {
            res.json({ version: 'unknown' });
        }
    } catch (e) {
        res.json({ version: 'unknown' });
    }
});

// API: Speed Test (Public endpoint)
app.get('/api/connectivity/speedtest', async (req, res) => {
    try {
        // exec already imported at top
        // util.promisify already imported as promisify
        const execPromise = promisify(exec);

        // Download 10MB file from Cloudflare and measure speed
        const testUrl = 'https://speed.cloudflare.com/__down?bytes=10000000';
        const curlCommand = `curl -o /dev/null -s -w '%{speed_download}' --max-time 30 ${testUrl}`;

        try {
            const { stdout } = await execPromise(curlCommand);
            const bytesPerSecond = parseFloat(stdout);
            const mbps = (bytesPerSecond * 8 / 1000000).toFixed(2); // Convert to Mbps

            res.json({
                success: true,
                download_mbps: parseFloat(mbps),
                download_bytes_per_second: bytesPerSecond,
                test_url: 'speed.cloudflare.com',
                timestamp: Date.now()
            });
        } catch (curlError: any) {
            res.status(500).json({
                success: false,
                error: 'Speed test failed',
                message: curlError?.message || 'Unknown error',
                timestamp: Date.now()
            });
        }
    } catch (e) {
        res.status(500).json({
            success: false,
            error: 'Failed to run speed test',
            timestamp: Date.now()
        });
    }
});

// API: Iperf Client
app.post('/api/connectivity/iperf/client', async (req, res) => {
    const { target, duration = 5, parallel = 1, reverse = false } = req.body;

    if (!target) {
        return res.status(400).json({ error: 'Target is required' });
    }

    if (!availableCommands.iperf3) {
        return res.status(503).json({ error: 'iperf3 not installed on server' });
    }

    log('IPERF', `Starting client test to ${target} (duration=${duration}s)...`);

    try {
        // Basic sanitization for target
        const sanitizedTarget = target.replace(/[^a-zA-Z0-9.-]/g, '');
        const args = ['-c', sanitizedTarget, '-t', duration.toString(), '-P', parallel.toString(), '-J'];
        if (reverse) args.push('-R');

        const iperfCmd = `iperf3 ${args.join(' ')}`;

        try {
            const { stdout } = await promisify(exec)(iperfCmd);
            const result = JSON.parse(stdout);

            // Handle iperf3 internal errors reported in JSON
            if (result.error) {
                return res.status(500).json({ error: 'Iperf test failed', message: result.error });
            }

            const sent_mbps = (result.end?.sum_sent?.bits_per_second / 1000000) ||
                (result.end?.sum?.bits_per_second / 1000000) || 0;
            const received_mbps = (result.end?.sum_received?.bits_per_second / 1000000) || 0;

            res.json({
                success: true,
                result: {
                    sent_mbps: parseFloat(sent_mbps.toFixed(2)),
                    received_mbps: parseFloat(received_mbps.toFixed(2)),
                    target: sanitizedTarget,
                    timestamp: Date.now()
                },
                raw: result
            });
        } catch (execError: any) {
            // iperf3 often exits with non-zero but might still have JSON in stdout (on partial failure)
            if (execError.stdout) {
                try {
                    const result = JSON.parse(execError.stdout);
                    if (result.error) {
                        return res.status(500).json({ error: 'Iperf test failed', message: result.error });
                    }
                } catch (e) { }
            }
            throw execError;
        }
    } catch (e: any) {
        log('IPERF', `Client test failed: ${e.message}`, 'error');
        res.status(500).json({ error: 'Iperf connection failed', message: e.message });
    }
});

// API: Iperf Server Status
app.get('/api/connectivity/iperf/server', (req, res) => {
    res.json({
        success: true,
        available: availableCommands.iperf3,
        running: !!iperfServerProcess && !iperfServerProcess.killed,
        port: 5201
    });
});

// Protect sensitive endpoints
// (We leave status/stats public? User asked for login to app. So we probably protect everything except login)
// Actually status/stats are read-only. Config is sensitive.
// But to prevent "background" viewing, we should protect everything.
// However, protecting /status might break the simple health check if we use curl? 
// Health check usually localhost.
// Let's protect config at least. 
// User said "security reason... login to the application". So dashboard should be hidden.

app.use('/api/config', authenticateToken);
app.use('/api/stats', authenticateToken);
app.use('/api/logs', authenticateToken);
app.use('/api/status', authenticateToken); // Protect status too

// Status Check (Unprotected for local health check?) 
// We can make a specific /health endpoint for Docker if needed, but for now protect all.





const STATS_FILE = path.join(APP_CONFIG.logDir, 'stats.json');
const TRAFFIC_HISTORY_FILE = path.join(APP_CONFIG.logDir, 'traffic-history.jsonl');
const TRAFFIC_HISTORY_RETENTION = 10080; // 7 days in minutes
// INTERFACES_FILE is already declared at the top of the file for the watcher
// INTERFACES_FILE is already declared at the top of the file for the watcher

console.log('Using config:', APP_CONFIG);

// Helper to read file safely
const readFile = (filePath: string) => {
    try {
        if (!fs.existsSync(filePath)) return null;
        return fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
        console.error(`Error reading ${filePath}:`, err);
        return null;
    }
};

// API: Get Status
app.get('/api/status', (req, res) => {
    // In Docker/Cross-container, checks via systemctl don't work.
    // We check if stats.json has been updated recently (heartbeat).
    const statsFile = path.join(APP_CONFIG.logDir, 'stats.json');

    fs.readFile(statsFile, 'utf8', (err, data) => {
        if (err) return res.json({ status: 'stopped' });

        try {
            const stats = JSON.parse(data);
            const lastUpdate = stats.timestamp; // Unix timestamp in seconds
            const now = Math.floor(Date.now() / 1000);

            // If updated within last 15 seconds, it's running
            if (now - lastUpdate < 15) {
                res.json({ status: 'running' });
            } else {
                res.json({ status: 'stopped' });
            }
        } catch (e) {
            res.json({ status: 'unknown' });
        }
    });
});

// API: Traffic Control - Get Status
// API: Traffic Control - Get Status
app.get('/api/traffic/status', (req, res) => {
    const defaultInterval = parseFloat(process.env.SLEEP_BETWEEN_REQUESTS || '1.0');

    if (fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
        try {
            const config = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8'));
            const control = config.control || { enabled: false, sleep_interval: defaultInterval };
            res.json({
                running: control.enabled || false,
                sleep_interval: control.sleep_interval || defaultInterval
            });
        } catch (e) {
            res.json({ running: false, sleep_interval: defaultInterval });
        }
    } else {
        res.json({ running: false, sleep_interval: defaultInterval });
    }
});

// API: Traffic Control - Start
app.post('/api/traffic/start', (req, res) => {
    const defaultInterval = parseFloat(process.env.SLEEP_BETWEEN_REQUESTS || '1.0');
    let config: any = { control: { enabled: true, sleep_interval: defaultInterval }, applications: [] };

    if (fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
        try {
            config = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8'));
            if (!config.control) config.control = { enabled: true, sleep_interval: defaultInterval };
            config.control.enabled = true;
        } catch (e) { }
    }

    fs.writeFileSync(APPLICATIONS_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('Traffic generation started via API');
    res.json({ success: true, running: true, sleep_interval: config.control.sleep_interval });
});

// API: Traffic Control - Stop
app.post('/api/traffic/stop', (req, res) => {
    const defaultInterval = parseFloat(process.env.SLEEP_BETWEEN_REQUESTS || '1.0');
    let config: any = { control: { enabled: false, sleep_interval: defaultInterval }, applications: [] };

    if (fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
        try {
            config = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8'));
            if (!config.control) config.control = { enabled: false, sleep_interval: defaultInterval };
            config.control.enabled = false;
        } catch (e) { }
    }

    fs.writeFileSync(APPLICATIONS_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log('Traffic generation stopped via API');
    res.json({ success: true, running: false, sleep_interval: config.control.sleep_interval });
});

// API: Traffic Control - Settings
app.post('/api/traffic/settings', authenticateToken, (req, res) => {
    const { sleep_interval } = req.body;
    if (typeof sleep_interval !== 'number') return res.status(400).json({ error: 'Invalid sleep_interval' });

    const defaultInterval = parseFloat(process.env.SLEEP_BETWEEN_REQUESTS || '1.0');
    let config: any = { control: { enabled: false, sleep_interval: defaultInterval }, applications: [] };

    if (fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
        try {
            config = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8'));
            if (!config.control) config.control = { enabled: false, sleep_interval: defaultInterval };
        } catch (e) { }
    }

    config.control.sleep_interval = Math.max(0.01, Math.min(60, sleep_interval));
    fs.writeFileSync(APPLICATIONS_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log(`Traffic sleep_interval updated to ${config.control.sleep_interval}s`);
    res.json({ success: true, settings: config.control });
});

// API: Voice Control - Status
app.get('/api/voice/status', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(VOICE_CONFIG_FILE)) {
            return res.json({ success: true, enabled: false, max_simultaneous_calls: 3, interface: getInterface() });
        }
        const config = JSON.parse(fs.readFileSync(VOICE_CONFIG_FILE, 'utf8'));
        const control = config.control || { enabled: false, max_simultaneous_calls: 3, interface: getInterface() };
        res.json({ success: true, ...control });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Voice Control - Toggle
app.post('/api/voice/control', authenticateToken, (req, res) => {
    try {
        const { enabled } = req.body;
        let config: any = { servers: [], control: { enabled: false, max_simultaneous_calls: 3, interface: getInterface() } };

        if (fs.existsSync(VOICE_CONFIG_FILE)) {
            config = JSON.parse(fs.readFileSync(VOICE_CONFIG_FILE, 'utf8'));
        }

        if (!config.control) {
            config.control = { enabled: false, max_simultaneous_calls: 3, interface: getInterface() };
        }

        config.control.enabled = !!enabled;
        fs.writeFileSync(VOICE_CONFIG_FILE, JSON.stringify(config, null, 2));
        res.json({ success: true, enabled: config.control.enabled });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Voice Configuration - Get
app.get('/api/voice/config', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(VOICE_CONFIG_FILE)) {
            return res.json({
                success: true,
                servers: "",
                control: { enabled: false, max_simultaneous_calls: 3, sleep_between_calls: 5, interface: getInterface() }
            });
        }
        const config = JSON.parse(fs.readFileSync(VOICE_CONFIG_FILE, 'utf8'));
        // Parse servers back to raw string for frontend textarea
        const rawServers = (config.servers || []).map((s: any) => `${s.target}|${s.codec}|${s.weight}|${s.duration}`).join('\n');
        res.json({ success: true, servers: rawServers, control: config.control });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Voice Configuration - Save
app.post('/api/voice/config', authenticateToken, (req, res) => {
    try {
        const { servers, control } = req.body;
        let currentConfig: any = { control: {}, servers: [], state: { counter: 0 } };
        if (fs.existsSync(VOICE_CONFIG_FILE)) {
            currentConfig = JSON.parse(fs.readFileSync(VOICE_CONFIG_FILE, 'utf8'));
        }

        if (control !== undefined) {
            currentConfig.control = { ...currentConfig.control, ...control };
        }

        if (servers !== undefined) {
            currentConfig.servers = servers.split('\n')
                .map((l: string) => l.trim())
                .filter((l: string) => l && !l.startsWith('#'))
                .map((l: string) => {
                    const [target, codec, weight, duration] = l.split('|');
                    return {
                        target: target || "",
                        codec: codec || "G.711-ulaw",
                        weight: parseInt(weight) || 50,
                        duration: parseInt(duration) || 30
                    };
                });
        }

        fs.writeFileSync(VOICE_CONFIG_FILE, JSON.stringify(currentConfig, null, 2));
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Voice Configuration - Export
app.get('/api/voice/config/export', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(VOICE_CONFIG_FILE)) return res.status(404).json({ error: 'Config not found' });
        const content = fs.readFileSync(VOICE_CONFIG_FILE, 'utf8');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=voice-config.json');
        res.send(content);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// API: Voice Configuration - Import
app.post('/api/voice/config/import', authenticateToken, (req, res) => {
    try {
        const { config } = req.body;
        console.log('[VOICE] Incoming import request');
        if (DEBUG) console.log('[VOICE] Import Payload:', JSON.stringify(config, null, 2));

        if (!config || !config.control || !config.servers) {
            console.error('[VOICE] Import failed: Invalid configuration structure', {
                hasConfig: !!config,
                hasControl: config ? !!config.control : false,
                hasServers: config ? !!config.servers : false
            });
            return res.status(400).json({ success: false, error: 'Invalid voice configuration: Missing control or servers' });
        }
        // Preserve state if possible
        if (fs.existsSync(VOICE_CONFIG_FILE)) {
            const current = JSON.parse(fs.readFileSync(VOICE_CONFIG_FILE, 'utf8'));
            config.state = config.state || current.state;
        }
        fs.writeFileSync(VOICE_CONFIG_FILE, JSON.stringify(config, null, 2));
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// API: Voice Stats
app.get('/api/voice/stats', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(VOICE_STATS_FILE)) {
            return res.json({ success: true, stats: [] });
        }
        // Read last 100 lines
        const execPromise = promisify(exec);
        exec(`tail -n 1000 ${VOICE_STATS_FILE}`, (error, stdout) => {
            if (error) return res.json({ success: true, stats: [] });
            const lines = stdout.trim().split('\n').filter(l => l.trim());
            try {
                const stats = lines.map(l => JSON.parse(l));
                res.json({ success: true, stats: stats.reverse() });
            } catch (err) {
                res.json({ success: true, stats: [] });
            }
        });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Reset Voice Stats
app.delete('/api/voice/stats', authenticateToken, (req, res) => {
    try {
        if (fs.existsSync(VOICE_STATS_FILE)) {
            fs.writeFileSync(VOICE_STATS_FILE, '');
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Reset Voice Counter
app.delete('/api/voice/counter', authenticateToken, (req, res) => {
    try {
        if (fs.existsSync(VOICE_CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(VOICE_CONFIG_FILE, 'utf8'));
            if (!config.state) config.state = {};
            config.state.counter = 9999; // Write 9999 so the next call is CALL-0000
            fs.writeFileSync(VOICE_CONFIG_FILE, JSON.stringify(config, null, 2));
        } else {
            // If config doesn't exist, create it with just the counter
            const config = { servers: [], control: {}, state: { counter: 9999 } };
            fs.writeFileSync(VOICE_CONFIG_FILE, JSON.stringify(config, null, 2));
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Get Stats
app.get('/api/stats', (req, res) => {
    const content = readFile(STATS_FILE);
    if (!content) return res.json({ error: 'Stats not found' });
    try {
        res.json(JSON.parse(content));
    } catch (e) {
        res.json({ error: 'Invalid JSON' });
    }
});

// API: Reset Stats
app.delete('/api/stats', authenticateToken, (req, res) => {
    try {
        const emptyStats = {
            timestamp: Math.floor(Date.now() / 1000),
            total_requests: 0,
            requests_by_app: {},
            errors_by_app: {}
        };
        fs.writeFileSync(STATS_FILE, JSON.stringify(emptyStats, null, 2));

        // Create a signal file for the traffic generator to reset its memory
        const resetSignalFile = path.join(APP_CONFIG.logDir, '.reset_stats');
        fs.writeFileSync(resetSignalFile, 'reset');

        // Also clear history
        if (fs.existsSync(TRAFFIC_HISTORY_FILE)) {
            fs.writeFileSync(TRAFFIC_HISTORY_FILE, '');
        }

        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Get Traffic History
app.get('/api/traffic/history', authenticateToken, async (req, res) => {
    try {
        if (!fs.existsSync(TRAFFIC_HISTORY_FILE)) {
            return res.json([]);
        }

        const range = (req.query.range as string) || '1h';
        let minutes = 60;
        if (range === '6h') minutes = 360;
        if (range === '24h') minutes = 1440;
        if (range === 'all') minutes = TRAFFIC_HISTORY_RETENTION;

        const { stdout } = await promisify(exec)(`tail -n ${minutes} "${TRAFFIC_HISTORY_FILE}"`);
        const history = stdout.split('\n')
            .filter(line => line.trim())
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            })
            .filter(item => item !== null);

        res.json(history);
    } catch (e: any) {
        res.status(500).json({ error: 'Failed to fetch traffic history', message: e.message });
    }
});

// API: Get Applications (Categorized)
app.get('/api/config/apps', extractUserMiddleware, (req, res) => {
    if (!fs.existsSync(APPLICATIONS_CONFIG_FILE)) return res.json({ error: 'Config not found' });

    const config = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8'));
    const lines = config.applications || [];
    const categories: { name: string, apps: any[] }[] = [];
    let currentCategory = 'Uncategorized';
    let currentApps: any[] = [];

    // Helper to push category
    const pushCategory = () => {
        if (currentApps.length > 0 || currentCategory !== 'Uncategorized') {
            // Find existing?
            const existing = categories.find(c => c.name === currentCategory);
            if (existing) {
                existing.apps.push(...currentApps);
            } else {
                categories.push({ name: currentCategory, apps: [...currentApps] });
            }
            currentApps = [];
        }
    };

    lines.forEach((item: any) => {
        if (typeof item === 'string') {
            const line = item.trim();
            if (!line) return;

            if (line.startsWith('#')) {
                const comment = line.substring(1).trim();
                if (!comment.toLowerCase().startsWith('format:') && !comment.toLowerCase().startsWith('weight:')) {
                    pushCategory();
                    currentCategory = comment;
                }
            } else {
                const parts = line.split('|');
                if (parts.length >= 2) {
                    const [domain, weight, endpoint] = parts;
                    currentApps.push({
                        domain,
                        weight: parseInt(weight) || 0,
                        endpoint: endpoint || '/'
                    });
                }
            }
        } else if (typeof item === 'object' && item !== null) {
            // Already an object, use its category if it exists
            const app = item;
            const appCategory = app.category || 'Uncategorized';

            if (appCategory !== currentCategory) {
                pushCategory();
                currentCategory = appCategory;
            }

            currentApps.push({
                domain: app.domain,
                weight: app.weight,
                endpoint: app.endpoint || '/'
            });
        }
    });
    pushCategory(); // Push last

    res.json(categories);
});
// Helper for DEM scoring
const calculateDEMScore = (type: string, reachable: boolean, httpCode: number | undefined, metrics: any): number => {
    if (!reachable || (httpCode && httpCode >= 500)) return 0;
    if (httpCode && httpCode >= 400) return 20;

    const lat = metrics.total_ms || 0;

    if (type === 'HTTP' || type === 'HTTPS') {
        const total_norm = Math.min(lat / 2000, 1.0);
        const ttfb_norm = Math.min(metrics.ttfb_ms / 1000, 1.0);
        const tls_norm = Math.min((metrics.tls_ms || 0) / 800, 1.0);

        let score = 100 - (30 * total_norm + 35 * ttfb_norm + 25 * tls_norm);
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    if (type === 'PING') {
        // Ping scoring: < 100ms = 100, > 500ms = 0
        if (lat < 100) return 100;
        const score = 100 - ((lat - 100) / 400) * 100;
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    if (type === 'TCP') {
        // TCP Connect scoring: < 150ms = 100, > 800ms = 0
        if (lat < 150) return 100;
        const score = 100 - ((lat - 150) / 650) * 100;
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    if (type === 'DNS') {
        // DNS Resolution scoring: < 80ms = 100, > 400ms = 0
        if (lat < 80) return 100;
        const score = 100 - ((lat - 80) / 320) * 100;
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    if (type === 'UDP') {
        // UDP Quality scoring: Jitter < 30ms, Loss < 1%
        const jitter = metrics.jitter_ms || 0;
        const loss = metrics.loss_pct || 0;

        let score = 100;
        // Deduct for loss: 0% = -0, 5% = -50, 10% = -100
        score -= (loss * 10);
        // Deduct for jitter: < 30ms = -0, 100ms = -50
        if (jitter > 30) {
            score -= Math.min(50, (jitter - 30) * 0.7);
        }
        return Math.max(0, Math.min(100, Math.round(score)));
    }

    return reachable ? 100 : 0;
};

const performConnectivityCheck = async (endpoint: any): Promise<ConnectivityResult> => {
    const startTime = Date.now();
    let result: ConnectivityResult = {
        timestamp: startTime,
        endpointId: endpoint.name.toLowerCase().replace(/\s+/g, '-'),
        endpointName: endpoint.name,
        endpointType: endpoint.type.toUpperCase() as 'HTTP' | 'HTTPS' | 'PING' | 'TCP' | 'UDP' | 'DNS',
        url: endpoint.target,
        reachable: false,
        metrics: { total_ms: 0 },
        score: 0
    };

    try {
        const execPromise = promisify(exec);
        if (endpoint.type.toLowerCase() === 'http' || endpoint.type.toLowerCase() === 'https') {
            const iface = getInterface();
            const ifaceFlag = (iface && iface !== 'eth0') ? `--interface ${iface}` : '';
            const curlCmd = `curl -o /dev/null -s -L -w "time_namelookup=%{time_namelookup}\\ntime_connect=%{time_connect}\\ntime_appconnect=%{time_appconnect}\\ntime_starttransfer=%{time_starttransfer}\\ntime_total=%{time_total}\\nhttp_code=%{http_code}\\nremote_ip=%{remote_ip}\\nremote_port=%{remote_port}\\nsize_download=%{size_download}\\nspeed_download=%{speed_download}\\nssl_verify_result=%{ssl_verify_result}\\n" -H 'Cache-Control: no-cache, no-store' -H 'Pragma: no-cache' --max-time ${Math.floor(endpoint.timeout / 1000)} ${ifaceFlag} "${endpoint.target}"`;

            try {
                const { stdout } = await execPromise(curlCmd);
                const curlData: any = {};
                stdout.split('\n').filter(l => l.includes('=')).forEach(line => {
                    const [key, value] = line.split('=');
                    if (key && value) curlData[key] = value.trim();
                });

                const total_ms = parseFloat(curlData.time_total) * 1000;
                if (total_ms > 0 || (curlData.http_code && parseInt(curlData.http_code) > 0)) {
                    result.reachable = true;
                    result.httpCode = parseInt(curlData.http_code);
                    result.remoteIp = curlData.remote_ip;
                    result.remotePort = parseInt(curlData.remote_port);
                    result.metrics = {
                        dns_ms: parseFloat(curlData.time_namelookup) * 1000,
                        tcp_ms: (parseFloat(curlData.time_connect) - parseFloat(curlData.time_namelookup)) * 1000,
                        tls_ms: parseFloat(curlData.time_appconnect) > 0 ? (parseFloat(curlData.time_appconnect) - parseFloat(curlData.time_connect)) * 1000 : 0,
                        ttfb_ms: (parseFloat(curlData.time_starttransfer) - Math.max(parseFloat(curlData.time_appconnect), parseFloat(curlData.time_connect))) * 1000,
                        total_ms: total_ms,
                        size_bytes: parseInt(curlData.size_download),
                        speed_bps: parseFloat(curlData.speed_download),
                        ssl_verify: parseInt(curlData.ssl_verify_result)
                    };
                    result.score = calculateDEMScore(result.endpointType, result.reachable, result.httpCode, result.metrics);
                }
            } catch (e) { }
        } else if (endpoint.type.toLowerCase() === 'ping') {
            const iface = getInterface();
            const ifaceFlag = (iface && iface !== 'eth0') ? `-I ${iface}` : '';
            const pingCommand = `ping -c 1 -W ${Math.floor(endpoint.timeout / 1000)} ${ifaceFlag} ${endpoint.target}`;
            const pStart = Date.now();
            try {
                const { stdout } = await execPromise(pingCommand);
                const duration = Date.now() - pStart;
                const timeMatch = stdout.match(/time[=<](\d+\.?\d*)/);
                const pingTime = timeMatch ? parseFloat(timeMatch[1]) : duration;
                result.reachable = true;
                result.metrics.total_ms = Math.round(pingTime);
                result.score = calculateDEMScore(result.endpointType, result.reachable, undefined, result.metrics);
            } catch (e) { }
        } else if (endpoint.type.toLowerCase() === 'tcp') {
            const [ip, port] = endpoint.target.split(':');
            const ncCommand = `nc -zv -w ${Math.floor(endpoint.timeout / 1000)} ${ip} ${port} 2>&1`;
            const tStart = Date.now();
            try {
                await execPromise(ncCommand);
                result.reachable = true;
                result.metrics.total_ms = Date.now() - tStart;
                result.score = calculateDEMScore(result.endpointType, result.reachable, undefined, result.metrics);
            } catch (e) { }
        } else if (endpoint.type.toLowerCase() === 'dns') {
            const dnsCommand = `dig +short +time=${Math.floor(endpoint.timeout / 1000)} google.com @${endpoint.target}`;
            const dStart = Date.now();
            try {
                const { stdout } = await execPromise(dnsCommand);
                if (stdout.trim().length > 0) {
                    result.reachable = true;
                    result.metrics.total_ms = Date.now() - dStart;
                    result.score = calculateDEMScore(result.endpointType, result.reachable, undefined, result.metrics);
                }
            } catch (e) { }
        } else if (endpoint.type.toLowerCase() === 'udp') {
            const parts = endpoint.target.split(':');
            const host = parts[0];
            const port = parts[1] || '5201';
            const iperfCmd = `iperf3 -u -c ${host} -p ${port} -b 50k -t 1 -J`;
            const uStart = Date.now();
            try {
                const { stdout } = await execPromise(iperfCmd);
                const uDuration = Date.now() - uStart;
                const data = JSON.parse(stdout);
                if (data.end && (data.end.sum || data.end.sum_received)) {
                    result.reachable = true;
                    const sum = data.end.sum_received || data.end.sum;
                    result.metrics = {
                        total_ms: sum.delay_ms || (sum.mean_latency ? sum.mean_latency * 1000 : uDuration),
                        jitter_ms: sum.jitter_ms || 0,
                        loss_pct: sum.lost_percent || 0,
                        size_bytes: sum.bytes || 0
                    };
                    result.score = calculateDEMScore(result.endpointType, result.reachable, undefined, result.metrics);
                }
            } catch (e) { }
        }
    } catch (e) { }
    return result;
};

// ===== CONNECTIVITY TEST HELPERS =====
const CUSTOM_CONNECTIVITY_FILE = path.join(APP_CONFIG.configDir, 'connectivity-custom.json');

// Helper: Get base endpoints from Envs
const getEnvConnectivityEndpoints = () => {
    const endpoints: any[] = [
        { name: 'Cloudflare ICMP', type: 'PING', target: '1.1.1.1', timeout: 2000 },
        { name: 'Google ICMP', type: 'PING', target: '8.8.8.8', timeout: 2000 },
        { name: 'Google DNS Res', type: 'DNS', target: '8.8.8.8', timeout: 3000 },
        { name: 'Google Search', type: 'HTTP', target: 'https://www.google.com', timeout: 5000 }
    ];

    Object.keys(process.env).forEach(key => {
        const value = process.env[key];
        if (!value) return;
        if (key.startsWith('CONNECTIVITY_HTTP_')) {
            const idx = value.indexOf(':');
            if (idx > 0) endpoints.push({ name: value.substring(0, idx), type: 'HTTP', target: value.substring(idx + 1), timeout: 5000 });
        } else if (key.startsWith('CONNECTIVITY_PING_')) {
            const [name, ip] = value.split(':');
            if (name && ip) endpoints.push({ name, type: 'PING', target: ip, timeout: 2000 });
        } else if (key.startsWith('CONNECTIVITY_TCP_')) {
            const parts = value.split(':');
            if (parts.length === 3) endpoints.push({ name: parts[0], type: 'TCP', target: `${parts[1]}:${parts[2]}`, timeout: 3000 });
        } else if (key.startsWith('CONNECTIVITY_UDP_')) {
            const parts = value.split(':');
            if (parts.length === 3) endpoints.push({ name: parts[0], type: 'UDP', target: `${parts[1]}:${parts[2]}`, timeout: 3000 });
        }
    });

    return endpoints;
};

// Helper: Get custom endpoints from file (used for custom added probes, plus state overrides for env/discovery probes)
const getCustomConnectivityEndpoints = () => {
    try {
        if (!fs.existsSync(CUSTOM_CONNECTIVITY_FILE)) return [];
        return JSON.parse(fs.readFileSync(CUSTOM_CONNECTIVITY_FILE, 'utf8'));
    } catch (e) {
        console.error('Failed to read custom connectivity endpoints:', e);
        return [];
    }
};

// Helper: Save custom endpoints
const saveCustomConnectivityEndpoints = (endpoints: any[]) => {
    try {
        fs.writeFileSync(CUSTOM_CONNECTIVITY_FILE, JSON.stringify(endpoints, null, 2));
        return true;
    } catch (e) {
        console.error('Failed to save custom connectivity endpoints:', e);
        return false;
    }
};

// API: Refresh Discovered Connectivity Probes
app.post('/api/probes/discovery/sync', authenticateToken, async (req, res) => {
    try {
        const result = await discoveryManager.syncProbes();
        res.json(result);
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// API: Internet Connectivity Test
// API: Get active probes list (dynamic + static)
app.get('/api/connectivity/active-probes', authenticateToken, (req, res) => {
    try {
        const envProbes = getEnvConnectivityEndpoints();
        const customProbes = getCustomConnectivityEndpoints();
        const discoveredProbes = discoveryManager.getProbes();

        // Merge env state with custom
        const mergedEnvProbes = envProbes.map((p: any) => {
            const override = customProbes.find((cp: any) => cp.name === p.name);
            return override ? { ...p, enabled: override.enabled } : p;
        });

        // Unique custom probes
        const pureCustom = customProbes.filter((p: any) => !envProbes.find(ep => ep.name === p.name));

        // Return all known probes so the frontend knows they exist (even if paused/disabled)
        const allProbes = [...mergedEnvProbes, ...pureCustom, ...discoveredProbes];

        res.json({
            success: true,
            probes: allProbes.map(p => ({
                id: p.name.toLowerCase().replace(/\s+/g, '-'),
                name: p.name,
                type: p.type.toUpperCase(),
                target: p.target
            }))
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch active probes' });
    }
});

app.get('/api/connectivity/test', authenticateToken, async (req, res) => {
    // console.log('[CONNECTIVITY] Starting internet connectivity test...'); // Silenced to reduce noise

    const envProbes = getEnvConnectivityEndpoints();
    const customProbes = getCustomConnectivityEndpoints();

    const mergedEnvProbes = envProbes.map((p: any) => {
        const override = customProbes.find((cp: any) => cp.name === p.name);
        return override ? { ...p, enabled: override.enabled } : p;
    });

    const testEndpoints: any[] = [
        ...mergedEnvProbes.filter((p: any) => p.enabled !== false),
        ...customProbes.filter((p: any) => !envProbes.find(ep => ep.name === p.name) && p.enabled !== false)
    ];

    const results = [];
    for (const endpoint of testEndpoints) {
        const checkResult = await performConnectivityCheck(endpoint);
        const legacyFormat = {
            name: checkResult.endpointName,
            type: checkResult.endpointType.toLowerCase(),
            status: checkResult.reachable ? 'connected' : 'failed',
            latency: Math.round(checkResult.metrics.total_ms),
            score: checkResult.score,
            details: checkResult.httpCode ? `HTTP ${checkResult.httpCode}` :
                (checkResult.endpointType === 'PING' ? 'ICMP' :
                    (checkResult.endpointType === 'UDP' ? `Jitter: ${checkResult.metrics.jitter_ms?.toFixed(1)}ms` : 'TCP')),
            metrics: checkResult.metrics
        };
        results.push(legacyFormat);
        await connectivityLogger.logResult(checkResult);

        const key = `${legacyFormat.type}:${legacyFormat.name}`;
        const lastStatus = lastConnectivityStatusMap.get(key);
        const lastScore = lastConnectivityScoreMap.get(key) || 0;
        const lastLogTime = lastConnectivityLogTimeMap.get(key) || 0;
        const now = Date.now();

        const shouldLog = !lastStatus ||
            lastStatus !== legacyFormat.status ||
            Math.abs(lastScore - legacyFormat.score) >= 20 ||
            (now - lastLogTime) > 60000;

        if (shouldLog) {
            log('CONNECTIVITY', `${legacyFormat.name} status: ${legacyFormat.status} (${legacyFormat.score}/100)`);
            lastConnectivityStatusMap.set(key, legacyFormat.status);
            lastConnectivityScoreMap.set(key, legacyFormat.score);
            lastConnectivityLogTimeMap.set(key, now);
        }
    }

    res.json({
        connected: results.some(r => r.status === 'connected'),
        results,
        timestamp: Date.now()
    });
});

app.get('/api/connectivity/public-ip', authenticateToken, async (req, res) => {
    try {
        const response = await fetch('https://ifconfig.me/ip');
        if (response.ok) {
            const ip = await response.text();
            res.json({ ip: ip.trim() });
        } else {
            res.status(500).json({ error: 'Failed to fetch public IP' });
        }
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/system/gateway-ip', authenticateToken, async (req, res) => {
    try {
        const platform = os.platform();
        let cmd = '';
        if (platform === 'darwin') {
            cmd = "route -n get default | awk '/gateway/ {print $2}'";
        } else if (platform === 'linux') {
            cmd = "ip route | grep default | awk '{print $3}' | head -n 1";
        } else {
            return res.json({ ip: 'Unknown OS' });
        }

        const execPromise = promisify(exec);
        const { stdout } = await execPromise(cmd);
        res.json({ ip: stdout.trim() });
    } catch (e: any) {
        console.error('Failed to get gateway IP:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// API: Get Custom Connectivity Endpoints
app.get('/api/connectivity/custom', authenticateToken, (req, res) => {
    const envProbes = getEnvConnectivityEndpoints();
    const custom = getCustomConnectivityEndpoints();
    const discovered = discoveryManager.getProbes();

    // Merge custom state into env probes and serve them all
    const mergedEnvProbes = envProbes.map((p: any) => {
        const override = custom.find((cp: any) => cp.name === p.name);
        return override ? { ...p, enabled: override.enabled } : p;
    });

    const pureCustom = custom.filter((p: any) => !envProbes.find(ep => ep.name === p.name));

    res.json([...mergedEnvProbes, ...pureCustom, ...discovered]);
});

// API: Update Custom Connectivity Endpoints
app.post('/api/connectivity/custom', authenticateToken, (req, res) => {
    const { endpoints } = req.body;
    if (!Array.isArray(endpoints)) return res.status(400).json({ error: 'Invalid format, expected array' });

    // The UI sends back ALL endpoints (Env, Custom, Discovered).
    // We update Discovery directly, and save everything else to custom (which now acts as state store for Env probes)
    const discoveredProbes = endpoints.filter(p => p.source === 'discovery');
    const customAndEnvProbes = endpoints.filter(p => p.source !== 'discovery');

    const customSuccess = saveCustomConnectivityEndpoints(customAndEnvProbes);
    discoveryManager.updateProbesFromUI(discoveredProbes);

    if (customSuccess) {
        res.json({ success: true, count: endpoints.length });
    } else {
        res.status(500).json({ error: 'Failed to save custom endpoints' });
    }
});

// API: Export Custom Connectivity Probes
app.get('/api/connectivity/custom/export', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(CUSTOM_CONNECTIVITY_FILE)) {
            return res.status(404).json({ error: 'Config file not found' });
        }
        res.download(CUSTOM_CONNECTIVITY_FILE, 'connectivity-custom.json');
    } catch (e: any) {
        res.status(500).json({ error: 'Export failed: ' + e.message });
    }
});

// API: Import Custom Connectivity Probes
app.post('/api/connectivity/custom/import', authenticateToken, (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: 'No content provided' });

        let probes;
        try {
            probes = typeof content === 'string' ? JSON.parse(content) : content;
        } catch (e) {
            return res.status(400).json({ error: 'Invalid JSON content' });
        }

        if (!Array.isArray(probes)) {
            return res.status(400).json({ error: 'Invalid format: expected array' });
        }

        // Validate structure
        for (const p of probes) {
            if (!p.name || !p.type || !p.target) {
                return res.status(400).json({ error: 'Invalid probe format: missing required fields' });
            }
        }

        // Backup
        if (fs.existsSync(CUSTOM_CONNECTIVITY_FILE)) {
            fs.copyFileSync(CUSTOM_CONNECTIVITY_FILE, CUSTOM_CONNECTIVITY_FILE + '.backup');
        }

        fs.writeFileSync(CUSTOM_CONNECTIVITY_FILE, JSON.stringify(probes, null, 2));
        res.json({ success: true, message: 'Probes imported successfully', count: probes.length });
    } catch (e: any) {
        res.status(500).json({ error: 'Import failed: ' + e.message });
    }
});

// New DEM APIs
app.get('/api/connectivity/results', authenticateToken, async (req, res) => {
    const { limit, offset, type, endpointId, timeRange } = req.query;
    const data = await connectivityLogger.getResults({
        limit: limit ? parseInt(limit as string) : 100,
        offset: offset ? parseInt(offset as string) : 0,
        type: type as string,
        endpointId: endpointId as string,
        timeRange: timeRange as string
    });
    res.json(data);
});

app.get('/api/connectivity/stats', authenticateToken, async (req, res) => {
    const { range } = req.query;

    const envProbes = getEnvConnectivityEndpoints();
    const customProbes = getCustomConnectivityEndpoints();
    const discoveredProbes = discoveryManager.getProbes();

    const mergedEnvProbes = envProbes.map((p: any) => {
        const override = customProbes.find((cp: any) => cp.name === p.name);
        return override ? { ...p, enabled: override.enabled } : p;
    });
    const pureCustom = customProbes.filter((p: any) => !envProbes.find(ep => ep.name === p.name));

    const allProbes = [...mergedEnvProbes, ...pureCustom, ...discoveredProbes];
    const activeProbeIds = allProbes.filter((p: any) => p.enabled !== false).map((p: any) => p.name.toLowerCase().replace(/\s+/g, '-'));

    const stats = await connectivityLogger.getStats({ timeRange: range as string, activeProbeIds });
    res.json(stats || { globalHealth: 0 });
});

// Background connectivity monitoring
const startConnectivityMonitor = (intervalMinutes: number = 5) => {
    console.log(`[DEM] Starting background connectivity monitoring (every ${intervalMinutes}m)`);

    const runMonitor = async () => {
        const testEndpoints: any[] = [
            ...getEnvConnectivityEndpoints(),
            ...getCustomConnectivityEndpoints(),
            ...discoveryManager.getProbes()
        ].filter(p => p.enabled !== false); // Only run probes that are not disabled

        if (testEndpoints.length === 0) return;

        for (const endpoint of testEndpoints) {
            const checkResult = await performConnectivityCheck(endpoint);
            await connectivityLogger.logResult(checkResult);
        }
    };

    // Run once at start after 30s to let system settle
    setTimeout(runMonitor, 30000);
    // Then periodically
    setInterval(runMonitor, intervalMinutes * 60 * 1000);
};

// Start monitor
startConnectivityMonitor(5);

// --- Phase 7: Convergence & Failover Testing ---

app.get('/api/convergence/endpoints', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(CONVERGENCE_ENDPOINTS_FILE)) return res.json([]);
        const endpoints = JSON.parse(fs.readFileSync(CONVERGENCE_ENDPOINTS_FILE, 'utf8'));
        res.json(endpoints);
    } catch (e) {
        res.status(500).json({ error: 'Failed to read endpoints' });
    }
});

app.post('/api/convergence/endpoints', authenticateToken, (req, res) => {
    try {
        const { label, target, port } = req.body;
        if (!label || !target) return res.status(400).json({ error: 'Label and Target required' });

        let endpoints = [];
        if (fs.existsSync(CONVERGENCE_ENDPOINTS_FILE)) {
            endpoints = JSON.parse(fs.readFileSync(CONVERGENCE_ENDPOINTS_FILE, 'utf8'));
        }

        const newEndpoint = {
            id: Date.now().toString(),
            label,
            target,
            port: port || 6100
        };

        endpoints.push(newEndpoint);
        fs.writeFileSync(CONVERGENCE_ENDPOINTS_FILE, JSON.stringify(endpoints, null, 2));
        res.json(newEndpoint);
    } catch (e) {
        res.status(500).json({ error: 'Failed to save endpoint' });
    }
});

app.delete('/api/convergence/endpoints/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        if (!fs.existsSync(CONVERGENCE_ENDPOINTS_FILE)) return res.status(404).json({ error: 'Not found' });

        let endpoints = JSON.parse(fs.readFileSync(CONVERGENCE_ENDPOINTS_FILE, 'utf8'));
        endpoints = endpoints.filter((e: any) => e.id !== id);
        fs.writeFileSync(CONVERGENCE_ENDPOINTS_FILE, JSON.stringify(endpoints, null, 2));
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Failed to delete endpoint' });
    }
});

app.delete('/api/convergence/counter', authenticateToken, (req, res) => {
    try {
        if (fs.existsSync(CONVERGENCE_COUNTER_FILE)) {
            // Write 9999 so the next call becomes CONV-0000
            fs.writeFileSync(CONVERGENCE_COUNTER_FILE, JSON.stringify({ counter: 9999 }));
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ─── Phase 8: Shared Targets Registry ───────────────────────────────────────

/** GET /api/targets — returns merged target list (managed + synthesized) */
app.get('/api/targets', authenticateToken, (req, res) => {
    try {
        res.json(targetsManager.getMergedTargets());
    } catch (e: any) {
        res.status(500).json({ error: 'Failed to load targets', detail: e.message });
    }
});

/** POST /api/targets — create a new managed target */
app.post('/api/targets', authenticateToken, (req, res) => {
    try {
        const { name, host, enabled, capabilities, ports } = req.body;
        if (!name || !host) return res.status(400).json({ error: 'name and host are required' });
        const newTarget = targetsManager.createTarget({ name, host, enabled: enabled ?? true, capabilities: capabilities || { voice: false, convergence: false, xfr: false, security: false, connectivity: false }, ports });
        log('TARGETS', `Created target: ${newTarget.name} (${newTarget.host})`);
        res.status(201).json(newTarget);
    } catch (e: any) {
        res.status(500).json({ error: 'Failed to create target', detail: e.message });
    }
});

/** PUT /api/targets/:id — update an existing managed target */
app.put('/api/targets/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const updated = targetsManager.updateTarget(id, req.body);
        if (!updated) return res.status(404).json({ error: 'Target not found' });
        log('TARGETS', `Updated target: ${updated.name} (${updated.host})`);
        res.json(updated);
    } catch (e: any) {
        res.status(500).json({ error: 'Failed to update target', detail: e.message });
    }
});

/** DELETE /api/targets/:id — delete a managed target */
app.delete('/api/targets/:id', authenticateToken, (req, res) => {
    try {
        const { id } = req.params;
        const deleted = targetsManager.deleteTarget(id);
        if (!deleted) return res.status(404).json({ error: 'Target not found or is synthesized (read-only)' });
        log('TARGETS', `Deleted target ${id}`);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: 'Failed to delete target', detail: e.message });
    }
});

app.get('/api/icons', async (req, res) => {
    const domain = req.query.domain as string;
    if (!domain) return res.status(400).json({ error: 'Domain required' });

    // Step 0: Check applications-config.json for manual overrides
    try {
        if (fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
            const config = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf-8'));
            const app = config.applications?.find((a: any) => a.domain === domain);
            if (app?.icon_url) {
                return res.json({ domain, faviconUrl: app.icon_url });
            }
        }
    } catch (e) {
        dbg(`[ICON] Error reading app config for icon override: ${e}`);
    }

    const cache = getIconCache();
    const entry = cache[domain];
    const TTL = 24 * 60 * 60 * 1000; // 24 hours

    if (entry && (Date.now() - entry.lastChecked < TTL) && entry.status === 'success') {
        return res.json({ domain, faviconUrl: entry.faviconUrl });
    }

    // Try to discover
    try {
        const faviconUrl = await fetchFavicon(domain);
        if (faviconUrl) {
            const newEntry: IconCacheEntry = {
                domain,
                faviconUrl,
                lastChecked: Date.now(),
                status: 'success'
            };
            saveIconCache(newEntry);
            return res.json({ domain, faviconUrl });
        } else {
            // Cache failure to avoid repeated hammering
            saveIconCache({
                domain,
                faviconUrl: '',
                lastChecked: Date.now(),
                status: 'failed'
            });
            return res.status(404).json({ error: 'Favicon not found' });
        }
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/convergence/start', authenticateToken, (req, res) => {
    const { target, port, rate, label } = req.body;
    const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const testId = (req as any).testId || getNextFailoverTestId();
    (req as any).testId = testId; // Ensure it's available for subsequent logs
    console.log(`[${testId}] [${timestamp}] 🚀 ${label || 'None'} - Incoming Start Request: Target=${target}:${port}, Rate=${rate}pps`);

    if (!target) return res.status(400).json({ error: 'Target IP required' });

    // Safety Scaling: Enforce a Global PPS limit of 500
    const currentTotalPPS = Array.from(convergencePPS.values()).reduce((a, b) => a + b, 0);
    const requestedPPS = parseInt(rate) || 50;
    const GLOBAL_PPS_LIMIT = 1000;

    if (currentTotalPPS + requestedPPS > GLOBAL_PPS_LIMIT) {
        return res.status(422).json({
            error: 'Global PPS Limit Exceeded',
            details: `Total system capacity is ${GLOBAL_PPS_LIMIT} PPS. Currently running ${currentTotalPPS} PPS. Please reduce rate or stop other probes.`
        });
    }

    const displayId = label ? `${testId} (${label})` : testId;
    const statsFile = `/tmp/convergence_stats_${testId}.json`;

    const orchestratorPath = path.join(PROJECT_ROOT, 'engines', 'convergence_orchestrator.py');

    if (!fs.existsSync(orchestratorPath)) {
        return res.status(500).json({ error: `Convergence orchestrator script missing at ${orchestratorPath}` });
    }

    const args = [
        orchestratorPath,
        '--target', target,
        '--port', (port || 6100).toString(),
        '--rate', (rate || 50).toString(),
        '--id', displayId,
        '--stats-file', statsFile
    ];

    const cmdStr = `python3 convergence_orchestrator.py -D ${target} -dport ${port || 6100} --rate ${rate || 50}pps --label "${label || ''}"`;
    console.log(`[${testId}] [${timestamp}] 🚀 Executing: ${cmdStr}`);

    try {
        const proc = spawn(PYTHON_PATH, args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
        convergenceProcesses.set(testId, proc);
        convergencePPS.set(testId, requestedPPS);

        proc.on('error', (err: any) => {
            console.error(`[CONVERGENCE-ERROR] Failed to start ${testId}: ${err.message}`);
            convergenceProcesses.delete(testId);
            convergencePPS.delete(testId);
        });

        proc.on('close', (code: any) => {
            const status = code === 0 || code === null ? 'SUCCESS' : 'FAILED';
            const emoji = code === 0 || code === null ? '✅' : '❌';
            log(`CONV-${testId}`, `${emoji} Convergence test ended: ${status} (exit code: ${code})`);

            convergenceProcesses.delete(testId);
            convergencePPS.delete(testId);

            // Finalize history entry

            // Finalize history entry
            if (fs.existsSync(statsFile)) {
                try {
                    const finalStats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
                    fs.appendFileSync(CONVERGENCE_HISTORY_FILE, JSON.stringify({
                        ...finalStats,
                        timestamp: Date.now()
                    }) + '\n');
                    // Cleanup tmp file
                    fs.unlinkSync(statsFile);

                    // ─── Fire-and-forget egress path enrichment ───────────────
                    // 60s delay allows the SD-WAN flow to be indexed in Prisma
                    const testNum = parseInt(testId.replace('CONV-', ''));
                    const sourcePort = 30000 + testNum;
                    const enrichTarget = target; // capture target IP in closure
                    console.log(`[${testId}] [CONV] Scheduling getflow enrichment in 60s (port ${sourcePort}, dst ${enrichTarget})`);
                    setTimeout(async () => {
                        try {
                            const siteInfo = siteManager.getSiteInfo();
                            const siteName = siteInfo?.detected_site_name;
                            if (!siteName) {
                                console.log(`[${testId}] [CONV] No site name detected, skipping getflow enrichment`);
                                return;
                            }
                            const result = await runGetflow(siteName, sourcePort, enrichTarget);
                            if (result?.flows && result.flows.length > 0) {
                                const rawPath = result.flows[0]?.egress_path || '';
                                const egressPath = rawPath.replace(/ to /g, ' → ');
                                await enrichConvergenceHistory(testId, { egress_path: egressPath });
                                console.log(`[${testId}] [CONV] Egress path enriched: ${egressPath}`);
                            } else {
                                console.log(`[${testId}] [CONV] Egress path: no flow found, skipping enrichment`);
                            }
                        } catch (e: any) {
                            console.warn(`[${testId}] [CONV] getflow enrichment error: ${e.message}`);
                        }
                    }, 60_000); // Fire-and-forget — never awaited
                    // ──────────────────────────────────────────────────────────

                } catch (e) { }
            }
        });

        res.json({ success: true, testId: testId });
    } catch (e: any) {
        return res.status(500).json({ error: 'Failed to launch convergence orchestrator' });
    }
});

app.post('/api/convergence/stop', authenticateToken, (req, res) => {
    const { testId } = req.body;
    if (testId) {
        const proc = convergenceProcesses.get(testId);
        if (proc) {
            proc.kill(); // Default is SIGTERM, which is usually fine. SIGINT is also an option.
            convergenceProcesses.delete(testId);
            convergencePPS.delete(testId);
            const now = new Date().toLocaleTimeString('en-GB', { hour12: false });
            console.log(`[${testId}] [${now}] 🛑 Stopped specific test`);
            return res.json({ success: true });
        }
        return res.status(404).json({ error: 'Test not found' });
    } else {
        // Stop all
        for (const [id, proc] of convergenceProcesses.entries()) {
            proc.kill();
            convergencePPS.delete(id);
        }
        convergenceProcesses.clear();
        console.log('[CONVERGENCE] Stopped all tests');
        res.json({ success: true, count: convergenceProcesses.size });
    }
});

app.get('/api/convergence/status', authenticateToken, (req, res) => {
    const results: any[] = [];
    try {
        const files = fs.readdirSync('/tmp').filter(f => f.startsWith('convergence_stats_') && f.endsWith('.json'));
        for (const file of files) {
            try {
                const stats = JSON.parse(fs.readFileSync(path.join('/tmp', file), 'utf8'));
                const testId = file.replace('convergence_stats_', '').replace('.json', '');
                results.push({
                    ...stats,
                    testId,
                    running: convergenceProcesses.has(testId)
                });
            } catch (e) { }
        }
    } catch (e) { }

    res.json(results);
});

app.get('/api/convergence/history', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(CONVERGENCE_HISTORY_FILE)) return res.json([]);
        const lines = fs.readFileSync(CONVERGENCE_HISTORY_FILE, 'utf8').split('\n').filter(l => l.trim());
        const history = lines.map(l => JSON.parse(l)).reverse().slice(0, 100);
        res.json(history);
    } catch (e) {
        res.status(500).json({ error: 'Failed to read history' });
    }
});

// API: GET Convergence Configuration
app.get('/api/config/convergence', authenticateToken, (req, res) => {
    try {
        if (!fs.existsSync(CONVERGENCE_CONFIG_FILE)) {
            const defaults = { good: 1, degraded: 5, critical: 10 };
            return res.json(defaults);
        }
        const data = JSON.parse(fs.readFileSync(CONVERGENCE_CONFIG_FILE, 'utf8'));
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: 'Failed to read convergence config' });
    }
});

// API: POST Convergence Configuration
app.post('/api/config/convergence', authenticateToken, (req, res) => {
    try {
        const { good, degraded, critical } = req.body;
        const config = {
            good: Math.max(1, Math.min(100, parseInt(good) || 1)),
            degraded: Math.max(1, Math.min(100, parseInt(degraded) || 5)),
            critical: Math.max(1, Math.min(100, parseInt(critical) || 10))
        };
        fs.writeFileSync(CONVERGENCE_CONFIG_FILE, JSON.stringify(config, null, 2));
        res.json({ success: true, config });
    } catch (e) {
        res.status(500).json({ error: 'Failed to save convergence config' });
    }
});

// API: Docker Statistics (Network, CPU, RAM) for all project containers
app.get('/api/connectivity/docker-stats', authenticateToken, async (req, res) => {
    try {
        const execPromise = promisify(exec);
        const results: any[] = [];
        const clockNow = Date.now();

        // Host Disk Stats
        let hostDisk = { total: 0, free: 0, used: 0, percent: 0 };
        try {
            const { stdout: dfOut } = await execPromise("df -B1 / --output=size,avail,used,pcent | tail -1");
            const [size, avail, used, pcent] = dfOut.trim().split(/\s+/);
            hostDisk = {
                total: parseInt(size),
                free: parseInt(avail),
                used: parseInt(used),
                percent: parseInt(pcent.replace('%', ''))
            };
        } catch (e) { }

        for (const cName of monitoredContainers) {
            try {
                // Get stats via Docker Socket
                const { stdout } = await execPromise(`curl --unix-socket /var/run/docker.sock http://localhost/containers/${cName}/stats?stream=false`);
                const stats = JSON.parse(stdout);

                const cStats = containerStatsMap.get(cName)!;

                // 1. Bitrate Calculation (Mbps)
                let rx_mbps = '0.00';
                let tx_mbps = '0.00';

                // For Docker, we might have multiple interfaces, take the sum
                let totalRx = 0;
                let totalTx = 0;
                if (stats.networks) {
                    Object.values(stats.networks).forEach((net: any) => {
                        totalRx += net.rx_bytes;
                        totalTx += net.tx_bytes;
                    });
                }

                if (cStats.prevNetwork) {
                    const deltaRx = totalRx - cStats.prevNetwork.rx;
                    const deltaTx = totalTx - cStats.prevNetwork.tx;
                    const deltaTime = (clockNow - cStats.prevNetwork.time) / 1000; // in seconds

                    if (deltaTime > 0) {
                        // bits per second = (bytes * 8) / seconds
                        // Mbps = bits / 1,000,000
                        rx_mbps = ((deltaRx * 8) / (deltaTime * 1000000)).toFixed(2);
                        tx_mbps = ((deltaTx * 8) / (deltaTime * 1000000)).toFixed(2);
                    }
                }
                cStats.prevNetwork = { rx: totalRx, tx: totalTx, time: clockNow };
                cStats.currentBitrate = { rx_low: totalRx, tx_low: totalTx, rx_mbps, tx_mbps };

                // 2. CPU Calculation
                let cpuPercent = '0.0';
                const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
                const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
                if (systemDelta > 0 && cpuDelta > 0) {
                    const onlineCpus = stats.cpu_stats.online_cpus || 1;
                    cpuPercent = ((cpuDelta / systemDelta) * onlineCpus * 100).toFixed(1);
                }
                cStats.currentCpuPercent = cpuPercent;

                results.push({
                    name: cName,
                    id: stats.id?.substring(0, 12),
                    network: {
                        rx_bytes: totalRx,
                        tx_bytes: totalTx,
                        rx_mb: (totalRx / 1024 / 1024).toFixed(2),
                        tx_mb: (totalTx / 1024 / 1024).toFixed(2),
                        received_mb: (totalRx / 1024 / 1024).toFixed(2),
                        transmitted_mb: (totalTx / 1024 / 1024).toFixed(2),
                        rx_mbps,
                        tx_mbps
                    },
                    memory: {
                        usage_bytes: stats.memory_stats.usage,
                        limit_bytes: stats.memory_stats.limit,
                        percent: ((stats.memory_stats.usage / stats.memory_stats.limit) * 100).toFixed(1)
                    },
                    cpu: {
                        percent: cpuPercent
                    }
                });
            } catch (e: any) {
                // If container not found or stats fail, return minimal info or fallback for current node
                if (cName === 'sdwan-web-ui') {
                    // Fallback to legacy single container check for the dashboard itself if socket fails
                    try {
                        const { stdout: netOut } = await execPromise('cat /sys/class/net/eth0/statistics/rx_bytes /sys/class/net/eth0/statistics/tx_bytes');
                        const [rx, tx] = netOut.trim().split('\n').map(Number);
                        const memUsage = parseInt(fs.readFileSync('/sys/fs/cgroup/memory.current', 'utf8').trim());
                        const memMax = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
                        const memLimit = memMax === 'max' ? os.totalmem() : parseInt(memMax);

                        const cStats = containerStatsMap.get(cName)!;
                        let rx_mbps = '0.00';
                        let tx_mbps = '0.00';

                        if (cStats.prevNetwork) {
                            const deltaRx = rx - cStats.prevNetwork.rx;
                            const deltaTx = tx - cStats.prevNetwork.tx;
                            const deltaTime = (clockNow - cStats.prevNetwork.time) / 1000;
                            if (deltaTime > 0) {
                                rx_mbps = ((deltaRx * 8) / (deltaTime * 1000000)).toFixed(2);
                                tx_mbps = ((deltaTx * 8) / (deltaTime * 1000000)).toFixed(2);
                            }
                        }
                        cStats.prevNetwork = { rx, tx, time: clockNow };
                        cStats.currentBitrate = { rx_low: rx, tx_low: tx, rx_mbps, tx_mbps };

                        results.push({
                            name: cName,
                            fallback: true,
                            network: {
                                rx_bytes: rx,
                                tx_bytes: tx,
                                rx_mb: (rx / 1024 / 1024).toFixed(2),
                                tx_mb: (tx / 1024 / 1024).toFixed(2),
                                received_mb: (rx / 1024 / 1024).toFixed(2),
                                transmitted_mb: (tx / 1024 / 1024).toFixed(2),
                                rx_mbps,
                                tx_mbps
                            },
                            memory: { usage_bytes: memUsage, limit_bytes: memLimit, percent: ((memUsage / memLimit) * 100).toFixed(1) },
                            cpu: { percent: cStats.currentCpuPercent } // Reverted to cStats.currentCpuPercent as currentCpuPercent is not defined in this scope
                        });
                    } catch (err) { }
                }
            }
        }

        res.json({
            success: true,
            containers: results,
            host: {
                disk: hostDisk
            },
            // For backward compatibility
            stats: results.find(r => r.name === 'sdwan-web-ui') || results[0],
            timestamp: clockNow
        });
    } catch (error: any) {
        console.error('[CONNECTIVITY] Failed to get Docker stats:', error.message);
        res.json({ success: false, error: error.message });
    }
});

// API: System Health Check
app.get('/api/system/health', authenticateToken, async (req, res) => {
    const now = Date.now();

    // Return cached result if fresh
    if (now - lastHealthCheckTime < HEALTH_CHECK_CACHE_MS && cachedHealthResult) {
        return res.json(cachedHealthResult);
    }

    log('SYSTEM', 'Running health check...');
    lastHealthCheckTime = now;

    const execPromise = promisify(exec);
    const dnsCmd = getDnsCommand('test.example.com');

    const health: any = {
        status: 'READY',
        timestamp: new Date().toISOString(),
        platform: PLATFORM,
        ready: true,
        commands: {
            dns: {
                available: true,
                selected: dnsCmd.type,
                command: dnsCmd.command.replace('test.example.com', '<domain>'),
                purpose: 'DNS Security Tests',
                fallback_chain: PLATFORM === 'darwin'
                    ? ['dscacheutil', 'dig', 'nslookup']
                    : PLATFORM === 'linux'
                        ? ['getent', 'dig', 'nslookup']
                        : ['nslookup']
            }
        },
        system: {
            memory: { total: 0, used: 0, free: 0, usedPercent: 0 },
            disk: { total: 0, used: 0, free: 0, usedPercent: 0, logDirUsage: 0 }
        },
        checks: []
    };

    // 1. Check if curl is available
    try {
        const { stdout: curlCheck } = await execPromise('which curl');
        health.commands.curl = {
            available: true,
            command: 'curl',
            purpose: 'URL Filtering & Threat Prevention Tests'
        };
        health.checks.push({ name: 'curl', status: 'PASS', detail: curlCheck.trim() });
    } catch (error) {
        health.status = 'DEGRADED';
        health.ready = false;
        health.checks.push({ name: 'curl', status: 'FAIL', detail: 'curl not found' });
    }

    // 2. Check if scapy/python is ready
    try {
        const { stdout: pyCheck } = await execPromise('python3 -c "import scapy; print(scapy.__version__)"');
        health.checks.push({ name: 'python-scapy', status: 'PASS', detail: pyCheck.trim() });
    } catch (e) {
        health.status = 'DEGRADED';
        health.checks.push({ name: 'python-scapy', status: 'FAIL', detail: 'scapy not installed' });
    }

    // 3. Get memory stats
    try {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        health.system.memory = {
            total: totalMem,
            used: usedMem,
            free: freeMem,
            usedPercent: Math.round((usedMem / totalMem) * 100)
        };
    } catch (error) {
        log('SYSTEM', `Failed to get memory stats: ${error}`, 'error');
    }

    // 4. Get disk stats
    try {
        const dfCommand = PLATFORM === 'darwin'
            ? `df -k ${APP_CONFIG.logDir} | tail -1 | awk '{print $2,$3,$4}'`
            : `df -k ${APP_CONFIG.logDir} | tail -1 | awk '{print $2,$3,$4}'`;

        const { stdout } = await execPromise(dfCommand);
        const [total, used, free] = stdout.trim().split(/\s+/).map(s => parseInt(s) * 1024);

        health.system.disk = {
            total,
            used,
            free,
            usedPercent: Math.round((used / total) * 100),
            logDirUsage: 0
        };

        const logStats = await testLogger.getStats();
        health.system.disk.logDirUsage = logStats.diskUsageBytes;
    } catch (error) {
        log('SYSTEM', `Failed to get disk stats: ${error}`, 'error');
    }

    cachedHealthResult = health;
    log('SYSTEM', `Health check complete: ${health.status}`);
    res.json(health);
});

// API: Update Application Weight (Single)
app.post('/api/config/apps', authenticateToken, (req, res) => {
    const { domain, weight } = req.body;
    updateAppsWeigth({ [domain]: weight }, res);
});

// API: Update Multiple Applications (Bulk)
app.post('/api/config/apps-bulk', authenticateToken, (req, res) => {
    const { updates } = req.body; // { "domain1": 50, "domain2": 30 }
    if (!updates || typeof updates !== 'object') {
        return res.status(400).json({ error: 'Invalid updates format' });
    }
    updateAppsWeigth(updates, res);
});

// API: Update Category Weight (Bulk - legacy support)
app.post('/api/config/category', authenticateToken, (req, res) => {
    const { updates } = req.body; // { "domain1": 50, "domain2": 50 }
    updateAppsWeigth(updates, res);
});

const updateAppsWeigth = (updates: Record<string, number>, res: any) => {
    if (!fs.existsSync(APPLICATIONS_CONFIG_FILE)) return res.status(500).json({ error: 'Config missing' });

    try {
        const config = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8'));
        const applications = config.applications || [];

        const newApps = applications.map((app: any) => {
            if (typeof app === 'string') {
                for (const [domain, weight] of Object.entries(updates)) {
                    if (app.startsWith(domain + '|')) {
                        const parts = app.split('|');
                        parts[1] = weight.toString();
                        return parts.join('|');
                    }
                }
            } else if (app && typeof app === 'object') {
                for (const [domain, weight] of Object.entries(updates)) {
                    if (app.domain === domain) {
                        return { ...app, weight: weight };
                    }
                }
            }
            return app;
        });

        config.applications = newApps;
        fs.writeFileSync(APPLICATIONS_CONFIG_FILE, JSON.stringify(config, null, 2));
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Operation failed', details: err });
    }
};

// API: Export Applications (Download applications.txt format from JSON)
app.get('/api/config/applications/export', (req, res) => {
    try {
        if (!fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
            return res.status(404).json({ error: 'Applications config not found' });
        }

        const format = req.query.format === 'json' ? 'json' : 'txt';
        const configContent = fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8');

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="applications-config.json"');
            return res.send(configContent);
        }

        // Legacy .txt format
        const config = JSON.parse(configContent);
        const applications = config.applications || [];
        const lines: string[] = [];
        let currentCategory = '';

        applications.forEach((app: any) => {
            if (typeof app === 'string') {
                lines.push(app);
            } else {
                const appCategory = app.category || 'Uncategorized';
                if (appCategory !== currentCategory) {
                    if (lines.length > 0) lines.push('');
                    lines.push(`# ${appCategory}`);
                    currentCategory = appCategory;
                }
                lines.push(`${app.domain}|${app.weight}|${app.endpoint || '/'}`);
            }
        });

        const content = lines.join('\n');
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'attachment; filename="applications.txt"');
        res.send(content);
    } catch (err: any) {
        res.status(500).json({ error: 'Export failed', details: err?.message });
    }
});

// API: Import Applications (Upload applications.txt into JSON)
app.post('/api/config/applications/import', (req, res) => {
    try {
        const { content } = req.body;

        if (!content || typeof content !== 'string') {
            return res.status(400).json({ error: 'Invalid file content' });
        }

        let applications: any[] = [];

        // Check if content is JSON
        try {
            const jsonData = JSON.parse(content);
            if (jsonData.applications && Array.isArray(jsonData.applications)) {
                applications = jsonData.applications;
                // If it's a full config with control, we might want to preserve it
                if (jsonData.control) {
                    // Handled below when merging with existing config
                }
            } else if (Array.isArray(jsonData)) {
                applications = jsonData;
            }
        } catch (e) {
            // Not JSON, parse as text
            const lines = content.split('\n');
            let currentCategory = 'Uncategorized';

            lines.forEach(line => {
                const trimmed = line.trim();
                if (!trimmed) return;

                if (trimmed.startsWith('#')) {
                    const comment = trimmed.substring(1).trim();
                    if (!comment.toLowerCase().startsWith('format:') && !comment.toLowerCase().startsWith('weight:')) {
                        currentCategory = comment;
                    }
                } else {
                    const parts = trimmed.split('|');
                    if (parts.length >= 2) {
                        applications.push({
                            domain: parts[0],
                            weight: parseInt(parts[1]) || 50,
                            endpoint: parts[2] || '/',
                            category: currentCategory
                        });
                    }
                }
            });
        }

        let config: any = { control: { enabled: false, sleep_interval: 1.0 }, applications: [] };
        if (fs.existsSync(APPLICATIONS_CONFIG_FILE)) {
            try {
                const existing = JSON.parse(fs.readFileSync(APPLICATIONS_CONFIG_FILE, 'utf8'));
                config.control = existing.control || config.control;
            } catch (e) { }
        }

        // If direct JSON import had control, use it
        try {
            const jsonData = JSON.parse(content);
            if (jsonData.control) config.control = jsonData.control;
        } catch (e) { }

        config.applications = applications;
        fs.writeFileSync(APPLICATIONS_CONFIG_FILE, JSON.stringify(config, null, 2));

        res.json({ success: true, count: applications.length });
    } catch (err: any) {
        res.status(500).json({ error: 'Import failed', details: err?.message });
    }
});

// API: Get Interfaces
app.get('/api/config/interfaces', (req, res) => {
    const showAll = req.query.all === 'true';
    if (showAll) {
        const autoDetectedInterfaces = os.networkInterfaces();
        const result = [];
        for (const name of Object.keys(autoDetectedInterfaces)) {
            for (const iface of autoDetectedInterfaces[name] || []) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    result.push(name);
                    break;
                }
            }
        }
        return res.json(result);
    }
    const content = readFile(INTERFACES_FILE);
    if (!content) return res.json([]);
    const interfaces = content.split('\n').filter(line => line && !line.startsWith('#'));
    res.json(interfaces);
});

// API: Save Interfaces
app.post('/api/config/interfaces', (req, res) => {
    const { interfaces } = req.body;
    if (!Array.isArray(interfaces)) return res.status(400).json({ error: 'Invalid format' });

    try {
        // Filter out any potential empty lines or comments before saving
        const cleanInterfaces = interfaces
            .map(i => i.trim())
            .filter(i => i && !i.startsWith('#'));

        fs.writeFileSync(INTERFACES_FILE, cleanInterfaces.join('\n'));

        // Sync IoT Manager with the new primary interface
        if (interfaces[0]) {
            iotManager.setInterface(interfaces[0]);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Write failed', details: err });
    }
});

// API: Get System Interfaces with Connectivity Test
app.get('/api/system/interfaces', authenticateToken, async (req, res) => {
    try {
        const execPromise = promisify(exec);
        const interfaces = os.networkInterfaces();
        const result: { name: string, ip: string, status: string, is_default: boolean }[] = [];

        // Get default interface
        let defaultIface = '';
        try {
            let command = '';
            if (process.platform === 'darwin') {
                command = "route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}'";
            } else {
                command = "ip route | grep '^default' | awk '{print $5}' | head -n 1";
            }
            const { stdout } = await execPromise(command);
            defaultIface = stdout.trim();
        } catch (e) {
            // Ignore, defaultIface stays empty
        }

        // Get all non-loopback IPv4 interfaces
        for (const name of Object.keys(interfaces)) {
            const iface = interfaces[name];
            if (iface) {
                for (const details of iface) {
                    if (details.family === 'IPv4' && !details.internal) {
                        // Test connectivity by pinging gateway
                        let status = 'unknown';
                        try {
                            // Try to ping gateway (simple test)
                            const pingCmd = process.platform === 'darwin'
                                ? `ping -c 1 -t 1 -b ${name} 8.8.8.8 2>/dev/null`
                                : `ping -c 1 -W 1 -I ${name} 8.8.8.8 2>/dev/null`;

                            await execPromise(pingCmd);
                            status = 'active';
                        } catch (e) {
                            status = 'inactive';
                        }

                        result.push({
                            name,
                            ip: details.address,
                            status,
                            is_default: name === defaultIface
                        });
                    }
                }
            }
        }

        res.json({
            interfaces: result,
            default_interface: defaultIface,
            platform: process.platform
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to detect interfaces', message: String(e) });
    }
});

// API: Get Auto-Detected Default Interface
app.get('/api/system/default-interface', authenticateToken, async (req, res) => {
    try {
        const execPromise = promisify(exec);
        let command = '';

        if (process.platform === 'darwin') {
            // macOS: use route to get default interface
            command = "route -n get default 2>/dev/null | grep 'interface:' | awk '{print $2}'";
        } else {
            // Linux: use ip route
            command = "ip route | grep '^default' | awk '{print $5}' | head -n 1";
        }

        const { stdout } = await execPromise(command);
        const iface = stdout.trim();

        if (iface) {
            res.json({ interface: iface, auto_detected: true, platform: process.platform });
        } else {
            // Fallback
            const fallback = process.platform === 'darwin' ? 'en0' : 'eth0';
            res.json({ interface: fallback, auto_detected: false, platform: process.platform });
        }
    } catch (e) {
        const fallback = process.platform === 'darwin' ? 'en0' : 'eth0';
        res.json({ interface: fallback, auto_detected: false, platform: process.platform, error: String(e) });
    }
});



// ✅ NEW: API Force Auto-Detect Interface (for first-time setup)
app.post('/api/system/auto-detect-interface', authenticateToken, async (req, res) => {
    try {
        console.log('🔍 INTERFACE: Manual auto-detection requested');

        const execPromise = promisify(exec);
        let defaultIface = '';
        let detectionMethod = '';
        let confidence = 'high';

        // Check if running in Docker container
        const isDocker = fs.existsSync('/.dockerenv') ||
            (fs.existsSync('/proc/1/cgroup') &&
                fs.readFileSync('/proc/1/cgroup', 'utf8').includes('docker'));

        if (isDocker) {
            defaultIface = 'eth0';
            detectionMethod = 'Docker container';
            console.log('🐳 INTERFACE: Docker detected, using eth0');
        } else if (PLATFORM === 'linux') {
            try {
                const { stdout } = await execPromise("ip route | grep default | awk '{print $5}' | head -n 1");
                defaultIface = stdout.trim();
                detectionMethod = 'Linux default route';

                if (defaultIface) {
                    const testCmd = `ip link show ${defaultIface} 2>/dev/null`;
                    try {
                        await execPromise(testCmd);
                        console.log(`✅ INTERFACE: Verified ${defaultIface} exists`);
                    } catch (e) {
                        console.log(`⚠️  INTERFACE: ${defaultIface} not found, using fallback`);
                        defaultIface = 'eth0';
                        detectionMethod = 'Fallback after verification failed';
                        confidence = 'low';
                    }
                }
            } catch (e) {
                defaultIface = 'eth0';
                detectionMethod = 'Linux fallback';
                confidence = 'low';
            }
        } else if (PLATFORM === 'darwin') {
            defaultIface = 'en0';
            detectionMethod = 'macOS default';
        } else {
            defaultIface = 'eth0';
            detectionMethod = 'Generic fallback';
            confidence = 'low';
        }

        if (defaultIface) {
            const interfacesFile = path.join(APP_CONFIG.configDir, 'interfaces.txt');
            const content = `# Auto-detected on ${new Date().toISOString()}\n` +
                `# Method: ${detectionMethod}\n` +
                `${defaultIface}\n`;
            fs.writeFileSync(interfacesFile, content, 'utf8');

            console.log(`✅ INTERFACE: Saved ${defaultIface} to config`);

            res.json({
                success: true,
                interface: defaultIface,
                method: detectionMethod,
                confidence,
                platform: PLATFORM,
                isDocker,
                message: `Successfully detected and configured interface: ${defaultIface}`
            });
        } else {
            res.json({
                success: false,
                error: 'Could not detect any network interface',
                platform: PLATFORM,
                suggestion: 'Please configure manually using: ip link show (Linux) or ifconfig (Mac/Windows)'
            });
        }
    } catch (error: any) {
        console.error('INTERFACE: Auto-detection error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Auto-detection failed',
            message: error.message,
            suggestion: 'Please configure network interface manually in Configuration page'
        });
    }
});

// API: Tail Logs (Simple last 50 lines)
app.get('/api/logs', (req, res) => {
    const logFile = path.join(APP_CONFIG.logDir, 'traffic.log');
    if (!fs.existsSync(logFile)) return res.json({ logs: [] });

    // Use tail command for efficiency
    const tail = spawn('tail', ['-n', '50', logFile]);
    let data = '';

    tail.stdout.on('data', chunk => data += chunk);
    tail.on('close', () => {
        res.json({ logs: data.split('\n').filter(l => l) });
    });
});

// ===== SECURITY TESTING API =====

const DEFAULT_SECURITY_CONFIG = {
    url_filtering: { enabled_categories: [], protocol: 'http' },
    dns_security: { enabled_tests: [] },
    threat_prevention: { enabled: false, eicar_endpoint: 'http://192.168.203.100/eicar.com.txt', eicar_endpoints: ['http://192.168.203.100/eicar.com.txt'] },
    scheduled_execution: {
        url: { enabled: false, interval_minutes: 60, last_run_time: null, next_run_time: null },
        dns: { enabled: false, interval_minutes: 60, last_run_time: null, next_run_time: null },
        threat: { enabled: false, interval_minutes: 120, last_run_time: null, next_run_time: null }
    },
    statistics: { total_tests_run: 0, url_tests_blocked: 0, url_tests_allowed: 0, dns_tests_blocked: 0, dns_tests_sinkholed: 0, dns_tests_allowed: 0, threat_tests_blocked: 0, threat_tests_allowed: 0, last_test_time: null },
    edlTesting: {
        ipList: { remoteUrl: null, lastSyncTime: 0, elements: [] },
        urlList: { remoteUrl: null, lastSyncTime: 0, elements: [] },
        dnsList: { remoteUrl: null, lastSyncTime: 0, elements: [] },
        testMode: 'sequential',
        randomSampleSize: 50,
        maxElementsPerRun: 200
    },
    test_history: []
};

// Helper: Get security config
const getSecurityConfig = () => {
    try {
        if (!fs.existsSync(SECURITY_CONFIG_FILE)) {
            // Migration is handled at startup, but for fresh installs:
            saveSecurityConfig(DEFAULT_SECURITY_CONFIG);
            return DEFAULT_SECURITY_CONFIG;
        }
        const data = fs.readFileSync(SECURITY_CONFIG_FILE, 'utf8');
        const config = JSON.parse(data);

        let migrated = false;
        // Basic sanity checks for missing fields
        if (!config.scheduled_execution) { config.scheduled_execution = { ...DEFAULT_SECURITY_CONFIG.scheduled_execution }; migrated = true; }
        if (!config.edlTesting) { config.edlTesting = { ...DEFAULT_SECURITY_CONFIG.edlTesting }; migrated = true; }
        if (!config.statistics) { config.statistics = { ...DEFAULT_SECURITY_CONFIG.statistics }; migrated = true; }

        if (migrated) saveSecurityConfig(config);
        return config;
    } catch (e) {
        console.error('Error reading security config:', e);
        return DEFAULT_SECURITY_CONFIG;
    }
};

/**
 * Returns a security configuration optimized for the UI.
 * It adds elementsCount to EDL lists and populates history from the log file.
 */
const getSecurityUIConfig = () => {
    const config = getSecurityConfig();
    if (!config) return null;

    const uiConfig = JSON.parse(JSON.stringify(config));

    // 1. Populate History from .jsonl (last 50 for UI)
    try {
        if (fs.existsSync(SECURITY_HISTORY_FILE)) {
            const data = execSync(`tail -n 50 "${SECURITY_HISTORY_FILE}"`, { encoding: 'utf8' });
            const lines = data.trim().split('\n').filter(l => l.trim());
            uiConfig.test_history = lines.map(l => JSON.parse(l)).reverse();
        } else {
            uiConfig.test_history = [];
        }
    } catch (e) {
        uiConfig.test_history = [];
    }

    // 2. Optimization for large EDL lists
    if (uiConfig.edlTesting) {
        const lists = ['ipList', 'urlList', 'dnsList'] as const;
        lists.forEach(l => {
            if (uiConfig.edlTesting[l]) {
                uiConfig.edlTesting[l].elementsCount = config.edlTesting[l].elements?.length || 0;
                delete uiConfig.edlTesting[l].elements;
            }
        });
    }
    return uiConfig;
};

// Helper: Save security config
const saveSecurityConfig = (config: any) => {
    try {
        const configToSave = { ...config };
        delete configToSave.test_history; // History is in .jsonl now
        fs.writeFileSync(SECURITY_CONFIG_FILE, JSON.stringify(configToSave, null, 2));
        return true;
    } catch (e) {
        console.error('Error saving security config:', e);
        return false;
    }
};

// Helper: Add test result to history
const addTestResult = async (testType: string, testName: string, result: any, testId?: number, details?: any) => {
    const config = getSecurityConfig();
    if (!config) return;

    const id = testId || getNextTestId();

    const historyEntry = {
        testId: id,
        timestamp: Date.now(),
        testType,
        testName,
        result,
    };

    // 1. Log to Security History Line-delimited JSON
    try {
        fs.mkdirSync(path.dirname(SECURITY_HISTORY_FILE), { recursive: true });
        fs.appendFileSync(SECURITY_HISTORY_FILE, JSON.stringify(historyEntry) + '\n');
    } catch (e) {
        console.error('Failed to log security result to history file:', e);
    }

    // 2. Update stats
    if (result.status) {
        updateStatistics(testType, result.status);
    }

    // 3. Log to general TestLogger 
    const testResult: TestResult = {
        id,
        timestamp: Date.now(),
        type: testType === 'url_filtering' ? 'url' : testType === 'dns_security' ? 'dns' : 'threat',
        name: testName,
        status: result.status || 'error',
        details: details || { ...result }
    };
    await testLogger.logTest(testResult);

    return id;
};

// Helper: Update statistics
const updateStatistics = (testType: string, status: string) => {
    const config = getSecurityConfig();
    if (!config) return;

    if (!config.statistics) {
        config.statistics = { ...DEFAULT_SECURITY_CONFIG.statistics };
    }

    config.statistics.total_tests_run++;
    config.statistics.last_test_time = Date.now();

    if (testType === 'url_filtering') {
        if (status === 'blocked') config.statistics.url_tests_blocked++;
        else config.statistics.url_tests_allowed++;
    } else if (testType === 'dns_security') {
        if (status === 'blocked') config.statistics.dns_tests_blocked++;
        else if (status === 'sinkholed') config.statistics.dns_tests_sinkholed++;
        else config.statistics.dns_tests_allowed++;
    } else if (testType === 'threat_prevention') {
        if (status === 'blocked') config.statistics.threat_tests_blocked++;
        else config.statistics.threat_tests_allowed++;
    }

    saveSecurityConfig(config);
};

// Scheduled Execution
let urlTestInterval: NodeJS.Timeout | null = null;
let dnsTestInterval: NodeJS.Timeout | null = null;
let threatTestInterval: NodeJS.Timeout | null = null;

const runScheduledUrlTests = async () => {
    const config = getSecurityConfig();
    if (!config || !config.scheduled_execution?.url?.enabled) return;

    console.log('Running scheduled URL filtering tests...');

    // Update next run time
    if (config.scheduled_execution?.url) {
        config.scheduled_execution.url.last_run_time = Date.now();
        config.scheduled_execution.url.next_run_time = Date.now() + (config.scheduled_execution.url.interval_minutes * 60 * 1000);
        saveSecurityConfig(config);
    }

    const execPromise = promisify(exec);

    for (const categoryId of config.url_filtering.enabled_categories) {
        const category = URL_CATEGORIES.find((c: any) => c.id === categoryId);
        if (!category) continue;

        try {
            // Capture HTTP code and content for keyword detection (Removed -f to allow 404 handling)
            const { stdout, stderr } = await execPromise(`curl -sSL --max-time 10 -w '%{http_code}' '${category.url}'`);

            const httpCode = parseInt(stdout.slice(-3));
            const content = stdout.slice(0, -3).toLowerCase();

            const isTestPage = content.includes('pandb test page') ||
                content.includes('categorized as');

            const isBlockPage = !isTestPage && (
                content.includes('palo alto networks') ||
                content.includes('access denied') ||
                content.includes('web-block-page'));

            // Treat 404 as 'allowed' if no block page is detected (Service might be down, but network allows it)
            const status = ((httpCode >= 200 && httpCode < 400) || (httpCode === 404 && !isBlockPage)) ? 'allowed' : 'blocked';

            updateStatistics('url_filtering', status);
            const testId = getNextTestId();
            addTestResult('url_filtering', category.name, {
                success: status === 'allowed',
                httpCode,
                status,
                url: category.url,
                category: category.name,
                blockPageDetected: isBlockPage,
                testPageDetected: isTestPage
            }, testId);

            console.log(`[SECURITY-URL] [${testId}] ${status.toUpperCase()} - Category: ${category.name} | Code: ${httpCode}${isBlockPage ? ' (Block Page Detected)' : ''}`);
        } catch (e) {
            updateStatistics('url_filtering', 'blocked');
            addTestResult('url_filtering', category.name, { success: false, status: 'blocked', url: category.url, category: category.name }, getNextTestId());
        }
    }
};

const runScheduledDnsTests = async () => {
    const config = getSecurityConfig();
    if (!config || !config.scheduled_execution?.dns?.enabled) return;

    console.log('Running scheduled DNS security tests...');

    // Update next run time
    if (config.scheduled_execution?.dns) {
        config.scheduled_execution.dns.last_run_time = Date.now();
        config.scheduled_execution.dns.next_run_time = Date.now() + (config.scheduled_execution.dns.interval_minutes * 60 * 1000);
        saveSecurityConfig(config);
    }

    const execPromise = promisify(exec);

    for (const testId of config.dns_security.enabled_tests) {
        const test = DNS_TEST_DOMAINS.find((t: any) => t.id === testId);
        if (!test) continue;

        try {
            const { command: dnsCommand, type: commandType } = getDnsCommand(test.domain);
            const { stdout, stderr } = await execPromise(dnsCommand);

            const combinedOutput = (stdout + stderr).toLowerCase();
            const sinkholeIPs = ['198.135.184.22', '72.5.65.111', '0.0.0.0', '127.0.0.1'];

            // Detection logic:
            // 1. Check for known sinkhole IPs
            // 2. Check for "sinkhole" in output (common for Palo Alto CNAMEs)
            // 3. check for "unknown host" or failures
            const isSinkholed = sinkholeIPs.some(ip => combinedOutput.includes(ip)) ||
                combinedOutput.includes('sinkhole');

            const isBlocked = !stdout.trim() ||
                combinedOutput.includes('name or service not known') ||
                combinedOutput.includes('server can\'t find') ||
                combinedOutput.includes('non-existent domain');

            let status = 'resolved';
            if (isSinkholed) status = 'sinkholed';
            else if (isBlocked) status = 'blocked';

            updateStatistics('dns_security', status);
            addTestResult('dns_security', test.name, {
                success: true,
                resolved: status === 'resolved',
                status,
                domain: test.domain,
                testName: test.name,
                output: stdout.substring(0, 500) // Store sample for UI
            }, getNextTestId());
        } catch (e: any) {
            // Even if the command exit code is non-zero, it might contain sinkhole info (like nslookup)
            const errorOutput = e.stdout + e.stderr;
            if (errorOutput && errorOutput.toLowerCase().includes('sinkhole')) {
                updateStatistics('dns_security', 'sinkholed');
                addTestResult('dns_security', test.name, {
                    success: true,
                    status: 'sinkholed',
                    domain: test.domain,
                    testName: test.name
                }, getNextTestId());
            } else {
                updateStatistics('dns_security', 'blocked');
                addTestResult('dns_security', test.name, {
                    success: false,
                    status: 'blocked',
                    domain: test.domain,
                    testName: test.name,
                    error: e.message
                }, getNextTestId());
            }
        }
    }
};

const runScheduledThreatTests = async () => {
    const config = getSecurityConfig();
    if (!config || !config.scheduled_execution?.threat?.enabled) return;

    console.log('Running scheduled threat prevention tests...');

    // Update next run time
    if (config.scheduled_execution?.threat) {
        config.scheduled_execution.threat.last_run_time = Date.now();
        config.scheduled_execution.threat.next_run_time = Date.now() + (config.scheduled_execution.threat.interval_minutes * 60 * 1000);
        saveSecurityConfig(config);
    }

    const execPromise = promisify(exec);
    const endpoints = config.threat_prevention.eicar_endpoints || [config.threat_prevention.eicar_endpoint];

    for (const endpoint of endpoints) {
        if (!endpoint) continue;
        try {
            await execPromise(`curl -fsS --max-time 20 ${endpoint} -o /tmp/eicar.com.txt && rm -f /tmp/eicar.com.txt`);
            updateStatistics('threat_prevention', 'allowed');
            addTestResult('threat_prevention', 'EICAR Test', { success: true, status: 'allowed', endpoint }, getNextTestId());
        } catch (e) {
            updateStatistics('threat_prevention', 'blocked');
            addTestResult('threat_prevention', 'EICAR Test', { success: false, status: 'blocked', endpoint }, getNextTestId());
        }
    }
};

const startSchedulers = () => {
    const config = getSecurityConfig();
    if (!config || !config.scheduled_execution) return;

    let modified = false;

    // URL Scheduler
    if (urlTestInterval) clearInterval(urlTestInterval);
    if (config.scheduled_execution.url?.enabled) {
        const interval = (config.scheduled_execution.url.interval_minutes || 15) * 60 * 1000;
        urlTestInterval = setInterval(runScheduledUrlTests, interval);
        config.scheduled_execution.url.next_run_time = Date.now() + interval;
        modified = true;
        console.log(`URL security scheduler enabled (every ${config.scheduled_execution.url.interval_minutes} minutes)`);
    }

    // DNS Scheduler
    if (dnsTestInterval) clearInterval(dnsTestInterval);
    if (config.scheduled_execution.dns?.enabled) {
        const interval = (config.scheduled_execution.dns.interval_minutes || 15) * 60 * 1000;
        dnsTestInterval = setInterval(runScheduledDnsTests, interval);
        config.scheduled_execution.dns.next_run_time = Date.now() + interval;
        modified = true;
        console.log(`DNS security scheduler enabled (every ${config.scheduled_execution.dns.interval_minutes} minutes)`);
    }

    // Threat Scheduler
    if (threatTestInterval) clearInterval(threatTestInterval);
    if (config.scheduled_execution.threat?.enabled) {
        const interval = (config.scheduled_execution.threat.interval_minutes || 30) * 60 * 1000;
        threatTestInterval = setInterval(runScheduledThreatTests, interval);
        config.scheduled_execution.threat.next_run_time = Date.now() + interval;
        modified = true;
        console.log(`Threat prevention scheduler enabled (every ${config.scheduled_execution.threat.interval_minutes} minutes)`);
    }

    if (modified) saveSecurityConfig(config);
};

const performSecurityStatsReset = () => {
    try {
        const config = getSecurityConfig();
        if (config) {
            config.statistics = {
                total_tests_run: 0,
                url_tests_blocked: 0,
                url_tests_allowed: 0,
                dns_tests_blocked: 0,
                dns_tests_sinkholed: 0,
                dns_tests_allowed: 0,
                threat_tests_blocked: 0,
                threat_tests_allowed: 0,
                last_test_time: null
            };
            config.test_history = [];
            saveSecurityConfig(config);

            // Also clear persistent logs via testLogger
            testLogger.deleteAll().catch(err => console.error('Failed to clear testLogger:', err));

            // Reset test counter to 0
            try {
                fs.writeFileSync(TEST_COUNTER_FILE, JSON.stringify({ counter: 0 }));
                console.log('[SECURITY] Scheduled reset: Test counter reset to 0');
            } catch (err) {
                console.error('[SECURITY] Scheduled reset: Failed to reset test counter:', err);
            }
            return true;
        }
    } catch (e: any) {
        console.error('[SECURITY] Scheduled reset failed:', e.message);
    }
    return false;
};

let dailyResetTimeout: NodeJS.Timeout | null = null;
let dailyResetInterval: NodeJS.Timeout | null = null;

const scheduleMidnightReset = () => {
    const now = new Date();
    const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1, // Tomorrow
        0, 0, 0, 0 // Midnight
    );

    const msUntilMidnight = midnight.getTime() - now.getTime();
    console.log(`[SECURITY] Next daily stats reset scheduled in ${(msUntilMidnight / 1000 / 60 / 60).toFixed(2)} hours`);

    if (dailyResetTimeout) clearTimeout(dailyResetTimeout);
    if (dailyResetInterval) clearInterval(dailyResetInterval);

    // Initial timeout to hit exactly midnight
    dailyResetTimeout = setTimeout(() => {
        console.log('[SECURITY] Executing midnight daily security stats reset');
        performSecurityStatsReset();

        // Then set a 24-hour interval
        dailyResetInterval = setInterval(() => {
            console.log('[SECURITY] Executing daily security stats reset');
            performSecurityStatsReset();
        }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
};

const stopAllSchedulers = () => {
    if (urlTestInterval) { clearInterval(urlTestInterval); urlTestInterval = null; }
    if (dnsTestInterval) { clearInterval(dnsTestInterval); dnsTestInterval = null; }
    if (threatTestInterval) { clearInterval(threatTestInterval); threatTestInterval = null; }
    console.log('All security schedulers disabled');
};

// Start schedulers on server startup
setTimeout(() => {
    startSchedulers();
    scheduleMidnightReset();

    // VyOS Health Check (60s)
    setInterval(() => {
        vyosManager.checkHealth().catch(e => console.error('[VYOS] Health check error:', e));
    }, 60000);

    // Traffic History Collector (60s)
    let lastTotalRequests = 0;
    let lastTimestamp = 0;

    setInterval(async () => {
        try {
            const statsFile = path.join(APP_CONFIG.logDir, 'stats.json');
            if (fs.existsSync(statsFile)) {
                const stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
                const now = Math.floor(Date.now() / 1000);

                let rpm = 0;
                if (lastTimestamp > 0 && now > lastTimestamp) {
                    const deltaReq = stats.total_requests - lastTotalRequests;
                    const deltaTime = now - lastTimestamp;
                    rpm = Math.max(0, (deltaReq / deltaTime) * 60);
                }

                const snapshot = {
                    timestamp: now,
                    rpm: Math.round(rpm * 100) / 100,
                    total_requests: stats.total_requests,
                    requests_by_app: stats.requests_by_app
                };

                fs.appendFileSync(TRAFFIC_HISTORY_FILE, JSON.stringify(snapshot) + '\n');

                lastTotalRequests = stats.total_requests;
                lastTimestamp = now;

                // Rotation Check (approx once per hour)
                if (Math.random() < 0.02) {
                    const { stdout } = await promisify(exec)(`wc -l "${TRAFFIC_HISTORY_FILE}"`);
                    const count = parseInt(stdout.trim().split(' ')[0]);
                    if (count > TRAFFIC_HISTORY_RETENTION * 1.2) {
                        const { stdout: recent } = await promisify(exec)(`tail -n ${TRAFFIC_HISTORY_RETENTION} "${TRAFFIC_HISTORY_FILE}"`);
                        fs.writeFileSync(TRAFFIC_HISTORY_FILE, recent);
                    }
                }
            }
        } catch (e) {
            console.error('[STATS] History collection failed:', e);
        }
    }, 60000);

    // VyOS Socket Events
    vyosScheduler.on('sequence:step', (data) => {
        io.emit('vyos:sequence_step', data);
    });
    vyosScheduler.on('sequence:completed', (log) => {
        io.emit('vyos:sequence_completed', log);
    });
}, 5000);


// API: Get Security Configuration
app.get('/api/security/config', authenticateToken, (req, res) => {
    const config = getSecurityUIConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });
    res.json(config);
});

// API: Update Security Configuration
app.post('/api/security/config', authenticateToken, (req, res) => {
    const config = getSecurityConfig();
    if (!config) return res.status(500).json({ error: 'Failed to read config' });

    const { url_filtering, dns_security, threat_prevention, scheduled_execution } = req.body;

    if (url_filtering) config.url_filtering = url_filtering;
    if (dns_security) config.dns_security = dns_security;
    if (threat_prevention) config.threat_prevention = threat_prevention;
    if (scheduled_execution !== undefined) {
        config.scheduled_execution = scheduled_execution;
        // Re-initialize all schedulers with new settings
        startSchedulers();
    }

    if (saveSecurityConfig(config)) {
        res.json({ success: true, config: getSecurityUIConfig() });
    } else {
        res.status(500).json({ error: 'Failed to save config' });
    }
});

// API: Get Test History (with search, pagination, filters)
app.get('/api/security/results', authenticateToken, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;
        const search = req.query.search as string;
        const type = req.query.type as 'url' | 'dns' | 'threat' | undefined;
        const status = req.query.status as 'blocked' | 'allowed' | 'sinkholed' | 'error' | undefined;

        const { results, total } = await testLogger.getResults({
            limit,
            offset,
            search,
            type,
            status
        });

        res.json({ results, total, limit, offset });
    } catch (error) {
        console.error('[API] Failed to get test results:', error);
        res.status(500).json({ error: 'Failed to retrieve test results' });
    }
});

// API: Get Single Test Result by ID
app.get('/api/security/results/:id', authenticateToken, async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const result = await testLogger.getResultById(id);

        if (result) {
            res.json(result);
        } else {
            res.status(404).json({ error: 'Test result not found' });
        }
    } catch (error) {
        console.error('[API] Failed to get test result:', error);
        res.status(500).json({ error: 'Failed to retrieve test result' });
    }
});

// API: Get Test Statistics
app.get('/api/security/results/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await testLogger.getStats();
        res.json(stats);
    } catch (error) {
        console.error('[API] Failed to get test stats:', error);
        res.status(500).json({ error: 'Failed to retrieve statistics' });
    }
});

// API: Reset Security Statistics
app.delete('/api/security/statistics', authenticateToken, (req, res) => {
    const success = performSecurityStatsReset();
    if (success) {
        res.json({ success: true });
    } else {
        res.status(500).json({ success: false, error: 'Failed to reset statistics' });
    }
});

// API: Clear Test History (manual cleanup)
app.delete('/api/security/results', authenticateToken, async (req, res) => {
    try {
        const before = req.query.before as string;

        if (before) {
            // Delete logs before specific date (not implemented yet - would need enhancement)
            res.status(501).json({ error: 'Date-based cleanup not yet implemented' });
        } else {
            // Delete all logs
            const deletedCount = await testLogger.deleteAll();
            res.json({ success: true, deletedCount });
        }
    } catch (error) {
        console.error('[API] Failed to clear test results:', error);
        res.status(500).json({ error: 'Failed to clear test results' });
    }
});

// API: URL Filtering Test
app.post('/api/security/url-test', authenticateToken, async (req, res) => {
    const { url, category } = req.body;

    const testId = getNextTestId();

    logTest(`[URL-TEST-${testId}] URL filtering test request: ${url} (${category || 'Uncategorized'})`);

    if (!url) {
        logTest(`[URL-TEST-${testId}] Test failed: No URL provided`);
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        // exec already imported at top
        // util.promisify already imported as promisify
        const execPromise = promisify(exec);

        const curlCommand = `curl -sSL --max-time 10 -w '%{http_code}' '${url}'`;
        logTest(`[URL-TEST-${testId}] Executing URL test for ${url} (${category || 'Uncategorized'}): ${curlCommand}`);

        try {
            const { stdout, stderr } = await execPromise(curlCommand);

            // The last 3 chars of stdout are the HTTP code
            const httpCodeString = stdout.trim().slice(-3);
            const httpCode = parseInt(httpCodeString);
            const content = stdout.slice(0, -httpCodeString.length).toLowerCase();

            logTest(`[URL-TEST-${testId}] HTTP response code: ${httpCode}`);

            const isTestPage = content.includes('pandb test page') ||
                content.includes('categorized as') ||
                content.includes('palo alto networks url filtering - test a site');

            const isBlockPage = !isTestPage && (
                content.includes('palo alto networks') ||
                content.includes('access denied') ||
                content.includes('web-block-page'));

            if (isTestPage) {
                logTest(`[URL-TEST-${testId}] Legitimate Palo Alto Test Page detected`);
            } else if (isBlockPage) {
                logTest(`[URL-TEST-${testId}] Block page detected in response content`);
            }

            const status = (httpCode >= 200 && httpCode < 400 && !isBlockPage) || (httpCode === 404 && !isBlockPage) ? 'allowed' : 'blocked';

            const result = {
                success: status === 'allowed',
                httpCode,
                status,
                url,
                category,
                blockPageDetected: isBlockPage,
                testPageDetected: isTestPage,
                reason: isTestPage ? 'Legitimate Palo Alto Test Page detected' :
                    isBlockPage ? 'Security Block Page detected in response content' :
                        (status === 'allowed') ? `Allowed (HTTP ${httpCode})` : `Blocked (HTTP ${httpCode})`
            };

            logTest(`[URL-TEST-${testId}] Final status: ${result.status} (HTTP ${httpCode})`);
            addTestResult('url_filtering', category || url, result, testId);
            res.json(result);
        } catch (curlError: any) {
            // Curl error usually means blocked or network error
            const result = {
                success: false,
                httpCode: 0,
                status: 'blocked',
                category,
                error: curlError.message,
                reason: `CURL Error: ${curlError.message.includes('timeout') ? 'Connection Timeout (Blocked by firewall drop?)' : curlError.message}`
            };

            logTest(`[URL-TEST-${testId}] Final status: blocked (curl error: ${curlError.message})`);
            addTestResult('url_filtering', category || url, result, testId);
            res.json(result);
        }
    } catch (e: any) {
        res.status(500).json({ error: 'Test execution failed', message: e.message });
    }
});

// API: URL Filtering Batch Test
app.post('/api/security/url-test-batch', authenticateToken, async (req, res) => {
    const { tests } = req.body; // Array of { url, category }

    if (!Array.isArray(tests) || tests.length === 0) {
        return res.status(400).json({ error: 'Tests array is required' });
    }

    const batchId = getNextBatchId();
    const results = [];

    logTest(`[URL-BATCH-${batchId}] Starting batch URL filtering test with ${tests.length} tests`);

    for (let i = 0; i < tests.length; i++) {
        const test = tests[i];
        const testId = getNextTestId();

        try {
            logTest(`[URL-BATCH-${batchId}][URL-TEST-${testId}] [${i + 1}/${tests.length}] Testing: ${test.url} (${test.category})`);

            const execPromise = promisify(exec);
            const curlCommand = `curl -sSL --max-time 10 -w '%{http_code}' '${test.url}'`;

            logTest(`[URL-TEST-${testId}] Executing URL test for ${test.url} (${test.category}): ${curlCommand}`);

            try {
                const { stdout, stderr } = await execPromise(curlCommand);

                const httpCodeString = stdout.trim().slice(-3);
                const httpCode = parseInt(httpCodeString);
                const content = stdout.slice(0, -httpCodeString.length).toLowerCase();

                logTest(`[URL-TEST-${testId}] HTTP response code: ${httpCode}`);

                const isTestPage = content.includes('pandb test page') ||
                    content.includes('categorized as');

                const isBlockPage = !isTestPage && (
                    content.includes('palo alto networks') ||
                    content.includes('access denied') ||
                    content.includes('web-block-page'));

                const status = (httpCode >= 200 && httpCode < 400 && !isBlockPage) || (httpCode === 404 && !isBlockPage) ? 'allowed' : 'blocked';

                const result = {
                    success: status === 'allowed',
                    httpCode,
                    status,
                    url: test.url,
                    category: test.category,
                    blockPageDetected: isBlockPage,
                    testPageDetected: isTestPage,
                    testId,
                    label: test.category || test.url, // Assuming label is category or url
                    target: test.url, // Assuming target is url
                    port: null, // Not applicable for URL tests, or derive if needed
                    rate: null, // Not applicable for URL tests, or derive if needed
                    timestamp: Date.now(),
                    max_blackout_ms: 0, // Not applicable for URL tests
                    loss_pct: 0, // Not applicable for URL tests
                    source_port: 0, // Not applicable for URL tests
                    rate_pps: 0, // Not applicable for URL tests
                    reason: isTestPage ? 'Legitimate Palo Alto Test Page detected' :
                        isBlockPage ? 'Security Block Page detected in response content' :
                            (status === 'allowed') ? `Allowed (HTTP ${httpCode})` : `Blocked (HTTP ${httpCode})`
                };

                logTest(`[URL-TEST-${testId}] Final status: ${status} (HTTP ${httpCode})`);

                results.push(result);
                await addTestResult('url_filtering', test.category, result, testId, {
                    url: test.url,
                    httpCode,
                    command: curlCommand,
                    blockPageDetected: isBlockPage,
                    testPageDetected: isTestPage
                });
            } catch (curlError: any) {
                logTest(`[URL-TEST-${testId}] Final status: blocked (curl error: ${curlError.message})`);

                const result = {
                    success: false,
                    httpCode: 0,
                    status: 'blocked',
                    url: test.url,
                    error: curlError.message,
                    reason: `CURL Error: ${curlError.message.includes('timeout') ? 'Connection Timeout (Blocked by firewall drop?)' : curlError.message}`
                };

                results.push(result);
                await addTestResult('url_filtering', test.category, result, testId, {
                    url: test.url,
                    error: curlError.message,
                    command: curlCommand
                });
            }
        } catch (e: any) {
            logTest(`[URL-TEST-${testId}] Error: ${e.message}`);

            results.push({
                success: false,
                status: 'error',
                url: test.url,
                category: test.category,
                error: e.message
            });
        }
    }

    logTest(`[URL-BATCH-${batchId}] Batch completed: ${results.length} tests executed`);
    res.json({ results });
});

// API: DNS Security Test
app.post('/api/security/dns-test', authenticateToken, async (req, res) => {
    const { domain, testName } = req.body;

    // Generate unique test ID
    const testId = getNextTestId();


    logTest(`[DNS-TEST-${testId}] DNS security test request: ${domain} (${testName || 'Custom Test'})`);

    if (!domain) {
        logTest(`[DNS-TEST-${testId}] Test failed: No domain provided`);
        return res.status(400).json({ error: 'Domain is required' });
    }

    try {
        // exec already imported at top
        // util.promisify already imported as promisify
        const execPromise = promisify(exec);

        // Get platform-specific DNS command
        const { command: dnsCommand, type: commandType } = getDnsCommand(domain);
        logTest(`[DNS-TEST-${testId}] Executing DNS test for ${domain} (${testName || 'Custom Test'}): ${dnsCommand}`);

        // Helper function to wait
        const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        try {
            // First attempt
            let { stdout, stderr } = await execPromise(dnsCommand);

            logTest(`[DNS-TEST-${testId}] DNS command output (attempt 1):`, stdout || '(empty)');

            // Parse output based on command type
            let resolvedIp = parseDnsOutput(stdout, commandType);

            // If no IP found, try a second time (DNS can be flaky)
            if (!resolvedIp) {
                logTest(`[DNS-TEST-${testId}] No IP in first attempt, retrying after 500ms...`);
                await wait(500);
                const result2 = await execPromise(dnsCommand);
                stdout = result2.stdout;
                logTest(`[DNS-TEST-${testId}] DNS command output (attempt 2):`, stdout || '(empty)');
                resolvedIp = parseDnsOutput(stdout, commandType);
            }

            // Known sinkhole IPs (Palo Alto Networks and common sinkhole addresses)
            const sinkholeIPs = [
                '198.135.184.22',  // Current Palo Alto sinkhole
                '72.5.65.111',     // Legacy Palo Alto sinkhole
                '::1',             // IPv6 sinkhole (loopback)
                '0.0.0.0',         // Common sinkhole
                '127.0.0.1'        // Loopback sinkhole
            ];

            // Determine status based on parsed IP or specific keywords
            let status: string;
            let resolved: boolean;

            const combinedOutput = (stdout + (stderr || '')).toLowerCase();
            const containsSinkholeKeyword = combinedOutput.includes('sinkhole');

            if (resolvedIp && sinkholeIPs.includes(resolvedIp)) {
                // Sinkhole IP detected
                status = 'sinkholed';
                resolved = false;
                logTest(`[DNS-TEST-${testId}] Status: SINKHOLED (IP: ${resolvedIp})`);
            } else if (containsSinkholeKeyword) {
                // Sinkhole keyword detected in output (CNAME or text)
                status = 'sinkholed';
                resolved = false;
                logTest(`[DNS-TEST-${testId}] Status: SINKHOLED (Keyword detected)`);
            } else if (!resolvedIp) {
                // No IP found - domain is blocked
                status = 'blocked';
                resolved = false;
                logTest(`[DNS-TEST-${testId}] Status: BLOCKED (no IP resolved)`);
            } else {
                // Normal resolution
                status = 'resolved';
                resolved = true;
                logTest(`[DNS-TEST-${testId}] Status: RESOLVED (IP: ${resolvedIp})`);
            }

            const result = {
                success: true,
                resolved,
                status,
                domain,
                testName,
                output: stdout,
                reason: status === 'sinkholed' ? `Resolved to Palo Alto Sinkhole IP: ${resolvedIp || 'Keyword detected'}` :
                    status === 'blocked' ? 'DNS Resolution failed or returned empty' : `Resolved to IP: ${resolvedIp}`
            };

            logTest(`[DNS-TEST-${testId}] Test result:`, { domain, status, resolved });
            addTestResult('dns_security', testName || domain, result, testId);
            res.json(result);
        } catch (dnsError: any) {
            // Even if the command failed (like nslookup returning SERVFAIL), it might contain sinkhole info
            const combinedErrorOutput = ((dnsError.stdout || '') + (dnsError.stderr || '')).toLowerCase();

            if (combinedErrorOutput.includes('sinkhole')) {
                logTest(`[DNS-TEST-${testId}] Command execution error, but SINKHOLE keyword found in output`);
                const result = {
                    success: true,
                    status: 'sinkholed',
                    resolved: false,
                    domain,
                    testName,
                    output: combinedErrorOutput,
                    reason: 'DNS error occurred, but Palo Alto Sinkhole keyword detected in response'
                };
                addTestResult('dns_security', testName || domain, result, testId);
                return res.json(result);
            }

            const isCommandError = dnsError.message.includes('command not found') ||
                dnsError.message.includes('not found');

            const result = {
                success: false,
                resolved: false,
                status: isCommandError ? 'error' : 'blocked',
                domain,
                testName,
                error: dnsError.message,
                reason: isCommandError ? 'DNS tool (dig/nslookup) not available' : `DNS Error: ${dnsError.message}`
            };

            logTest(`[DNS-TEST-${testId}] Error: ${isCommandError ? 'Command not available' : 'DNS blocked'} - ${dnsError.message}`);

            addTestResult('dns_security', testName || domain, result, testId);
            res.json(result);
        }
    } catch (e: any) {
        res.status(500).json({ error: 'Test execution failed', message: e.message });
    }
});

// API: DNS Security Batch Test
app.post('/api/security/dns-test-batch', authenticateToken, async (req, res) => {
    const { tests } = req.body; // Array of { domain, testName }

    if (!Array.isArray(tests) || tests.length === 0) {
        return res.status(400).json({ error: 'Tests array is required' });
    }

    const results = [];
    const batchId = getNextBatchId(); // Unique rotating batch ID

    // Helper function to wait
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    logTest(`[DNS-BATCH-${batchId}] Starting batch test with ${tests.length} domains`);

    for (let i = 0; i < tests.length; i++) {
        const test = tests[i];
        const testId = getNextTestId(); // Generate unique ID for each test

        logTest(`[DNS-BATCH-${batchId}][DNS-TEST-${testId}] [${i + 1}/${tests.length}] Testing: ${test.domain} (${test.testName})`);

        try {
            // exec already imported at top
            // util.promisify already imported as promisify
            const execPromise = promisify(exec);

            // Get platform-specific DNS command
            const { command: dnsCommand, type: commandType } = getDnsCommand(test.domain);

            try {
                // First attempt
                let { stdout, stderr } = await execPromise(dnsCommand);

                logTest(`[DNS-TEST-${testId}] First query result: ${stdout.trim() || '(empty)'}`);

                // If first attempt returns empty, retry after 1.5 seconds
                if (!stdout.trim()) {
                    logTest(`[DNS-TEST-${testId}] First query empty, retrying...`);
                    await wait(1500);
                    const retry = await execPromise(dnsCommand);
                    stdout = retry.stdout;
                    stderr = retry.stderr;
                }

                // Known sinkhole IPs and Keywords
                const combinedOutput = (stdout + (stderr || '')).toLowerCase();
                const sinkholeIPs = ['198.135.184.22', '72.5.65.111', '0.0.0.0', '127.0.0.1'];

                const isSinkholed = sinkholeIPs.some(ip => combinedOutput.includes(ip)) ||
                    combinedOutput.includes('sinkhole');

                const isBlocked = !stdout.trim() ||
                    combinedOutput.includes('can\'t find') ||
                    combinedOutput.includes('not known') ||
                    combinedOutput.includes('non-existent domain');

                const status = isSinkholed ? 'sinkholed' : (isBlocked ? 'blocked' : 'resolved');

                logTest(`[DNS-TEST-${testId}] Final status: ${status} (isSinkholed=${isSinkholed}, isBlocked=${isBlocked})`);

                const result = {
                    success: true,
                    resolved: status === 'resolved',
                    status,
                    domain: test.domain,
                    testName: test.testName,
                    reason: status === 'sinkholed' ? 'Sinkhole IP/Keyword detected' :
                        status === 'blocked' ? 'DNS Resolution failed/empty' : 'Normal resolution'
                };

                results.push(result);
                addTestResult('dns_security', test.testName, result, testId);
            } catch (dnsError: any) {
                // Check if it's actually a sinkhole response masked as an error (e.g., nslookup SERVFAIL)
                const combinedErrorOutput = ((dnsError.stdout || '') + (dnsError.stderr || '')).toLowerCase();

                if (combinedErrorOutput.includes('sinkhole')) {
                    const result = {
                        success: true,
                        status: 'sinkholed',
                        resolved: false,
                        domain: test.domain,
                        testName: test.testName,
                        reason: 'Sinkhole keyword detected in error output'
                    };
                    results.push(result);
                    addTestResult('dns_security', test.testName, result, testId);
                } else {
                    const isCommandError = dnsError.message.includes('command not found') || dnsError.message.includes('not found');
                    const result = {
                        success: false,
                        resolved: false,
                        status: isCommandError ? 'error' : 'blocked',
                        domain: test.domain,
                        testName: test.testName,
                        error: dnsError.message
                    };
                    results.push(result);
                    addTestResult('dns_security', test.testName, result, testId);
                }
            }
        } catch (e: any) {
            results.push({
                success: false,
                status: 'error',
                domain: test.domain,
                testName: test.testName,
                error: e.message
            });
        }
    }

    res.json({ results });
});

// --- EDL (External Dynamic List) API ---

// Helper: Validate IP Address or Subnet
const isValidIp = (ip: string): boolean => {
    // Basic IPv4 / Subnet regex
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\/(?:[0-9]|[12][0-9]|3[0-2]))?$/;
    return ipRegex.test(ip);
};

// Helper: Validate Domain Name
const isValidDomain = (domain: string): boolean => {
    const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-2][a-z0-9-]{0,61}[a-z0-2]$/i;
    return domainRegex.test(domain);
};

// Helper: Validate URL
const isValidUrl = (url: string): boolean => {
    try {
        // If it doesn't have protocol, add it for validation
        const toVal = url.includes('://') ? url : `http://${url}`;
        new URL(toVal);
        return true;
    } catch (e) {
        return false;
    }
};

// Helper: Parse EDL content with validation
const parseEdlContent = (content: string, type?: 'ip' | 'url' | 'dns') => {
    const rawLines = content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && !line.startsWith(';'));

    if (!type) return rawLines;

    // Apply strict validation based on type
    return rawLines.filter(line => {
        if (type === 'ip') return isValidIp(line);
        if (type === 'dns') return isValidDomain(line);
        if (type === 'url') return isValidUrl(line);
        return true;
    });
};

// API: Get EDL Configuration
app.get('/api/security/edl-config', authenticateToken, (req, res) => {
    const config = getSecurityConfig();
    const edl = config.edlTesting;

    // Return config without full elements list
    res.json({
        success: true,
        config: {
            ipList: { ...edl.ipList, elementsCount: edl.ipList.elements.length, elements: undefined },
            urlList: { ...edl.urlList, elementsCount: edl.urlList.elements.length, elements: undefined },
            dnsList: { ...edl.dnsList, elementsCount: edl.dnsList.elements.length, elements: undefined },
            testMode: edl.testMode,
            randomSampleSize: edl.randomSampleSize,
            maxElementsPerRun: edl.maxElementsPerRun
        }
    });
});

// API: Update EDL Configuration
app.post('/api/security/edl-config', authenticateToken, (req, res) => {
    const config = getSecurityConfig();
    const updates = req.body;

    if (updates.ipList?.remoteUrl !== undefined) config.edlTesting.ipList.remoteUrl = updates.ipList.remoteUrl;
    if (updates.urlList?.remoteUrl !== undefined) config.edlTesting.urlList.remoteUrl = updates.urlList.remoteUrl;
    if (updates.dnsList?.remoteUrl !== undefined) config.edlTesting.dnsList.remoteUrl = updates.dnsList.remoteUrl;
    if (updates.testMode) config.edlTesting.testMode = updates.testMode;
    if (updates.randomSampleSize !== undefined) config.edlTesting.randomSampleSize = parseInt(updates.randomSampleSize);
    if (updates.maxElementsPerRun !== undefined) config.edlTesting.maxElementsPerRun = parseInt(updates.maxElementsPerRun);

    if (saveSecurityConfig(config)) {
        res.json({ success: true, config: config.edlTesting });
    } else {
        res.status(500).json({ error: 'Failed to save configuration' });
    }
});

// API: Sync EDL from Remote URL
app.post('/api/security/edl-sync', authenticateToken, async (req, res) => {
    const { type } = req.body;
    const config = getSecurityConfig();

    const listMap: Record<string, any> = {
        'ip': config.edlTesting.ipList,
        'url': config.edlTesting.urlList,
        'dns': config.edlTesting.dnsList
    };

    const targetList = listMap[type];
    if (!targetList) return res.status(400).json({ error: 'Invalid list type' });
    if (!targetList.remoteUrl) return res.status(400).json({ error: 'No remote URL configured' });

    try {
        const execPromise = promisify(exec);
        // Using curl to fetch the list. Param escaping is basic here but respects the spec.
        const { stdout } = await execPromise(`curl -fsS --max-time 20 "${targetList.remoteUrl}"`);

        const elements = parseEdlContent(stdout, type);
        targetList.elements = elements;
        targetList.lastSyncTime = Date.now();

        if (saveSecurityConfig(config)) {
            res.json({ success: true, type, elementsCount: elements.length });
        } else {
            res.status(500).json({ error: 'Failed to save synced data' });
        }
    } catch (error: any) {
        res.status(500).json({ error: 'Sync failed', message: error.message });
    }
});

// API: Upload EDL File
app.post('/api/security/edl-upload', authenticateToken, upload.single('file'), (req: any, res) => {
    const { type } = req.body;
    const file = req.file;

    if (!file) return res.status(400).json({ error: 'No file uploaded' });

    const config = getSecurityConfig();
    const listMap: Record<string, any> = {
        'ip': config.edlTesting.ipList,
        'url': config.edlTesting.urlList,
        'dns': config.edlTesting.dnsList
    };

    const targetList = listMap[type];
    if (!targetList) return res.status(400).json({ error: 'Invalid list type' });

    try {
        const content = file.buffer.toString('utf8');
        const elements = parseEdlContent(content, type);
        targetList.elements = elements;
        targetList.lastSyncTime = Date.now();

        if (saveSecurityConfig(config)) {
            res.json({ success: true, type, elementsCount: elements.length });
        } else {
            res.status(500).json({ error: 'Failed to save uploaded data' });
        }
    } catch (error: any) {
        res.status(500).json({ error: 'Upload processing failed', message: error.message });
    }
});

// API: Execute EDL Tests
app.post('/api/security/edl-test', authenticateToken, async (req, res) => {
    const { type, mode, limit } = req.body;
    const testId = getNextTestId();
    const config = getSecurityConfig();
    const edl = config.edlTesting;

    log(`EDL-TEST-${testId}`, `Request received: type=${type}, mode=${mode === 'random' ? 'random' : 'sequential'}, limit=${limit || edl.maxElementsPerRun}`);

    const listMap: Record<string, any> = {
        'ip': edl.ipList,
        'url': edl.urlList,
        'dns': edl.dnsList
    };

    const targetList = listMap[type];
    if (!targetList || !targetList.elements || !targetList.elements.length) {
        logTest(`[EDL-TEST-${testId}] Error: List is empty or invalid`);
        return res.status(400).json({ error: 'List is empty or invalid' });
    }

    const testMode = mode || edl.testMode;
    const effectiveLimit = Math.min(
        limit || edl.maxElementsPerRun,
        edl.maxElementsPerRun,
        targetList.elements.length
    );

    let testElements = [...targetList.elements];
    if (testMode === 'random') {
        testElements = testElements.sort(() => Math.random() - 0.5);
    }
    testElements = testElements.slice(0, effectiveLimit);

    log(`EDL-TEST-${testId}`, `Selected ${testElements.length} elements for testing (${testMode})`);

    const results: any[] = [];
    const execPromise = promisify(exec);

    // Parallel execution with concurrency limit
    const concurrency = 10;
    for (let i = 0; i < testElements.length; i += concurrency) {
        const batch = testElements.slice(i, i + concurrency);
        await Promise.all(batch.map(async (item) => {
            try {
                if (type === 'url') {
                    const url = item.startsWith('http') ? item : `http://${item}`;
                    // Use a shorter timeout per item
                    const curlCmd = `curl -fsS --max-time 10 -o /dev/null -w "%{http_code}" "${url}"`;
                    try {
                        const { stdout } = await execPromise(curlCmd);
                        const code = parseInt(stdout);
                        const status = (code >= 200 && code < 400) ? 'allowed' : 'blocked';
                        results.push({ value: item, status, details: `HTTP ${code}`, timestamp: Date.now() });
                    } catch (e: any) {
                        results.push({ value: item, status: 'blocked', details: e.message.includes('timeout') ? 'Timeout' : 'Blocked', timestamp: Date.now() });
                    }
                } else if (type === 'dns') {
                    const { command } = getDnsCommand(item);
                    try {
                        const { stdout } = await execPromise(command);
                        const resolvedIp = parseDnsOutput(stdout, command.startsWith('nslookup') ? 'nslookup' : 'dig');
                        const status = resolvedIp ? 'allowed' : 'blocked';
                        results.push({ value: item, status, details: resolvedIp ? `IP: ${resolvedIp}` : 'NXDOMAIN', timestamp: Date.now() });
                    } catch (e: any) {
                        results.push({ value: item, status: 'blocked', details: 'DNS Error', timestamp: Date.now() });
                    }
                } else if (type === 'ip') {
                    const pingCmd = PLATFORM === 'darwin' ? `ping -c 1 -t 2 ${item}` : `ping -c 1 -W 2 ${item}`;
                    try {
                        await execPromise(pingCmd);
                        results.push({ value: item, status: 'allowed', details: 'Ping OK', timestamp: Date.now() });
                    } catch (e) {
                        results.push({ value: item, status: 'blocked', details: 'Timeout/Unreachable', timestamp: Date.now() });
                    }
                }
            } catch (e: any) {
                results.push({ value: item, status: 'error', details: e.message, timestamp: Date.now() });
            }
        }));
    }

    const allowedCount = results.filter(r => r.status === 'allowed').length;
    const blockedCount = results.filter(r => r.status === 'blocked').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    const successRate = results.length > 0 ? (allowedCount / results.length).toFixed(2) : "0.00";

    const summary = {
        success: true,
        type,
        mode: testMode,
        testedCount: results.length,
        allowedCount,
        blockedCount,
        errorCount,
        successRate: parseFloat(successRate),
        results: results.sort((a, b) => b.timestamp - a.timestamp)
    };

    log(`EDL-TEST-${testId}`, `Completed: tested=${summary.testedCount}, allowed=${allowedCount}, blocked=${blockedCount}, errors=${errorCount} (${(parseFloat(successRate) * 100).toFixed(0)}% OK)`);

    // --- INTEGRATION: Global History & Stats ---
    try {
        const globalCategory = (type === 'dns') ? 'dns_security' : 'url_filtering';
        const testName = `EDL ${type.toUpperCase()} Run (${summary.testedCount} items)`;

        // Update statistics for each item in the batch
        // We do this manually to avoid multiple saveSecurityConfig calls in addTestResult
        const configToUpdate = getSecurityConfig();
        if (configToUpdate && configToUpdate.statistics) {
            configToUpdate.statistics.total_tests_run += results.length;
            results.forEach(r => {
                if (globalCategory === 'url_filtering') {
                    if (r.status === 'blocked') configToUpdate.statistics.url_tests_blocked++;
                    else configToUpdate.statistics.url_tests_allowed++;
                } else {
                    if (r.status === 'blocked') configToUpdate.statistics.dns_tests_blocked++;
                    else configToUpdate.statistics.dns_tests_allowed++;
                }
            });
            configToUpdate.statistics.last_test_time = Date.now();
            saveSecurityConfig(configToUpdate);
        }

        // Add a single history entry for the whole batch
        await addTestResult(
            globalCategory,
            testName,
            {
                status: summary.successRate >= 0.8 ? 'allowed' : 'blocked', // General status for the batch
                ...summary,
                isBatch: true // Flag for UI to render table
            },
            testId
        );
    } catch (e) {
        console.error('[EDL-TEST] Failed to update global history:', e);
    }

    res.json(summary);
});

// API: Threat Prevention Test (EICAR)
app.post('/api/security/threat-test', authenticateToken, async (req, res) => {
    const { endpoint } = req.body;

    const testId = getNextTestId();

    logTest(`[THREAT-TEST-${testId}] EICAR test request received: ${endpoint} (Threat Prevention Test)`);

    if (!endpoint) {
        logTest(`[THREAT-TEST-${testId}] Test failed: No endpoint provided`);
        return res.status(400).json({ error: 'Endpoint URL is required' });
    }

    // Validate URL format
    try {
        new URL(endpoint);
    } catch (e) {
        console.log('[DEBUG] EICAR test failed: Invalid URL format:', endpoint);
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    const results = [];

    try {
        // exec already imported at top
        // util.promisify already imported as promisify
        const execPromise = promisify(exec);

        // Support single endpoint or array
        const endpointsArray = Array.isArray(endpoint) ? endpoint : [endpoint];

        for (const ep of endpointsArray) {
            let hostname = '';
            try { hostname = new URL(ep).hostname; } catch (e) { hostname = ep; }

            logTest(`[THREAT-TEST-${testId}] Testing reachability for ${hostname}...`);

            // Check reachability first (ping with 2s timeout)
            const pingCmd = process.platform === 'darwin'
                ? `ping -c 1 -t 2 ${hostname} > /dev/null 2>&1`
                : `ping -c 1 -W 2 ${hostname} > /dev/null 2>&1`;

            let isReachable = true;
            try {
                await execPromise(pingCmd);
            } catch (e) {
                isReachable = false;
                logTest(`[THREAT-TEST-${testId}] ${hostname} is unreachable via ping`);
            }

            const curlCommand = `curl -fsS --connect-timeout 5 --max-time 20 ${ep} -o /tmp/eicar.com.txt && rm -f /tmp/eicar.com.txt`;
            logTest(`[THREAT-TEST-${testId}] Executing EICAR test for ${ep}: ${curlCommand}`);

            try {
                await execPromise(curlCommand);
                logTest(`[THREAT-TEST-${testId}] EICAR file downloaded successfully from ${ep}`);

                const result = {
                    success: true,
                    status: 'allowed',
                    endpoint: ep,
                    message: 'EICAR file downloaded successfully (not blocked by IPS)'
                };

                logTest(`[THREAT-TEST-${testId}] EICAR test result: ALLOWED`, { endpoint: ep });
                addTestResult('threat_prevention', `EICAR Test (${ep})`, result, testId);
                results.push(result);
            } catch (curlError: any) {
                const exitCode = curlError.code;
                logTest(`[THREAT-TEST-${testId}] Curl failed with exit code: ${exitCode}`);

                let status = 'blocked';
                let message = 'EICAR download blocked (IPS triggered)';
                let success = false;

                // Curl exit codes: 7 = Failed to connect, 28 = Operation timeout
                if (exitCode === 7 || exitCode === 28 || !isReachable) {
                    status = 'unreachable';
                    message = !isReachable ? `Host ${hostname} is unreachable` : `Connection failed/timed out (check connectivity)`;
                    success = false;
                }

                const result = {
                    success,
                    status,
                    endpoint: ep,
                    message,
                    error: curlError.message,
                    reason: status === 'unreachable' ? 'Host unreachable or connection timeout' : 'CURL error (IPS likely dropped connection)'
                };

                logTest(`[THREAT-TEST-${testId}] EICAR test result: ${status.toUpperCase()}`, { endpoint: ep, error: curlError.message });
                addTestResult('threat_prevention', `EICAR Test (${ep})`, result, testId);
                results.push(result);
            }
        }

        console.log('[DEBUG] EICAR test completed:', { totalTests: results.length, results });
        res.json({ success: true, results });
    } catch (e: any) {
        console.log('[DEBUG] EICAR test error:', e.message);
        res.status(500).json({ error: 'Test execution failed', message: e.message });
    }
});

// Serve frontend in production
// --- Phase 17: Maintenance & System Upgrades ---

app.get('/api/admin/system/info', authenticateToken, async (req, res) => {
    try {
        // 1. Memory
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;

        // 2. Disk
        let disk = { total: 0, used: 0, free: 0, usagePercent: 0 };
        try {
            const { stdout } = await promisify(exec)('df -k / | tail -n 1');
            const parts = stdout.trim().split(/\s+/);
            if (parts.length >= 5) {
                // df -k gives 1K-blocks. Convert to bytes.
                disk.total = parseInt(parts[1], 10) * 1024;
                disk.used = parseInt(parts[2], 10) * 1024;
                disk.free = parseInt(parts[3], 10) * 1024;
                disk.usagePercent = parseInt(parts[4].replace('%', ''), 10);
            }
        } catch (e) {
            console.error('Failed to read disk space', e);
        }

        // 3. Network I/O
        let network = { rx: 0, tx: 0 };
        try {
            if (fs.existsSync('/proc/net/dev')) {
                const iface = getInterface();
                const netDev = await fs.promises.readFile('/proc/net/dev', 'utf8');
                const line = netDev.split('\n').find(l => l.trim().startsWith(iface + ':'));
                if (line) {
                    const parts = line.split(':')[1].trim().split(/\s+/);
                    network.rx = parseInt(parts[0], 10);
                    network.tx = parseInt(parts[8], 10);
                }
            }
        } catch (e) {
            console.error('Failed to read network stats', e);
        }

        // 4. Execution Context (Bridge vs Host)
        let mode = 'Bridge Mode';
        const nets = os.networkInterfaces();
        // If we see interfaces typical of a host machine, it's host mode
        const hasHostInterfaces = Object.keys(nets).some(name =>
            name.startsWith('en') || name.startsWith('wl') || name.startsWith('wlan') ||
            (name.startsWith('eth') && name !== 'eth0')
        );
        if (hasHostInterfaces) {
            mode = 'Host Mode';
        }

        // 5. Per-interface IPv4 addresses for Settings UI
        const interfaceIps: Record<string, string> = {};
        for (const [name, addrs] of Object.entries(nets)) {
            const ipv4 = addrs?.find(a => a.family === 'IPv4' && !a.internal);
            if (ipv4) interfaceIps[name] = ipv4.address;
        }

        res.json({
            memory: { total: totalMem, used: usedMem, free: freeMem },
            disk,
            network,
            mode,
            interfaceIps
        });
    } catch (e: any) {
        console.error('[API] /api/admin/system/info error:', e.message);
        res.status(500).json({ error: 'Failed to retrieve system info' });
    }
});

app.get('/api/admin/system/dashboard-data', authenticateToken, async (req, res) => {
    try {
        const statsFile = path.join(APP_CONFIG.logDir, 'stats.json');

        // 1. Stats (Non-blocking)
        let stats = { total_requests: 0, requests_by_app: {}, errors_by_app: {}, timestamp: Math.floor(Date.now() / 1000) };
        try {
            const statsData = await fs.promises.readFile(statsFile, 'utf8');
            stats = JSON.parse(statsData);
        } catch (e) { }

        // 2. Traffic Status (Heartbeat)
        let status = 'stopped';
        if (stats.timestamp) {
            const now = Math.floor(Date.now() / 1000);
            if (now - stats.timestamp < 10) status = 'running';
        }

        // 3. Logs (last 50) - Non-blocking with fallback
        let logs: string[] = [];
        try {
            const logCandidates = [
                path.join(APP_CONFIG.logDir, 'traffic.log'),
                path.join(APP_CONFIG.logDir, 'test-execution.log')
            ];
            let activeLogFile = logCandidates.find(f => fs.existsSync(f));

            if (activeLogFile) {
                const { stdout } = await promisify(exec)(`tail -n 50 "${activeLogFile}"`);
                logs = stdout.toString().split('\n').filter(l => l);
            }
        } catch (e) { }

        // 4. Docker Stats
        const dockerResults: any[] = [];
        containerStatsMap.forEach((val, key) => {
            dockerResults.push({ container: key, ...val });
        });

        // 5. Convergence Status (Non-blocking)
        const convergenceResults: any[] = [];
        try {
            const tmpFiles = await fs.promises.readdir('/tmp');
            const targetFiles = tmpFiles.filter(f => f.startsWith('convergence_stats_') && f.endsWith('.json'));

            await Promise.all(targetFiles.map(async (file) => {
                try {
                    const content = await fs.promises.readFile(path.join('/tmp', file), 'utf8');
                    const cStats = JSON.parse(content);
                    const testId = file.replace('convergence_stats_', '').replace('.json', '');
                    convergenceResults.push({
                        ...cStats,
                        testId,
                        running: convergenceProcesses.has(testId)
                    });
                } catch (e) { }
            }));
        } catch (e) { }

        // 6. Voice Status & Stats (Non-blocking)
        let voiceStats: any[] = [];
        let voiceControl = { enabled: false };
        try {
            if (fs.existsSync(VOICE_CONFIG_FILE)) {
                const vData = await fs.promises.readFile(VOICE_CONFIG_FILE, 'utf8');
                const vConfig = JSON.parse(vData);
                voiceControl = vConfig.control || { enabled: false };
            }
            if (fs.existsSync(VOICE_STATS_FILE)) {
                const { stdout: vsOut } = await promisify(exec)(`tail -n 200 "${VOICE_STATS_FILE}"`);
                voiceStats = vsOut.toString().trim().split('\n')
                    .filter(l => l.trim())
                    .map(l => {
                        try { return JSON.parse(l); } catch (err) { return null; }
                    })
                    .filter(l => l)
                    .reverse();
            }
        } catch (e) { }

        res.json({
            stats,
            status,
            logs,
            dockerStats: dockerResults,
            convergenceTests: convergenceResults,
            voice: {
                control: voiceControl,
                stats: voiceStats
            },
            registry: {
                ...registryManager.getStatus(),
                mode: process.env.STIGIX_REGISTRY_MODE || 'peer',
                local_registry_active: process.env.STIGIX_REGISTRY_MODE === 'leader'
            },
            timestamp: Date.now()
        });
    } catch (e: any) {
        console.error('[SYSTEM] ❌ Dashboard data aggregation failed:', e);
        res.status(500).json({ error: 'Failed to aggregate dashboard data', details: e.message });
    }
});

app.get('/api/admin/maintenance/version', authenticateToken, async (req, res) => {
    try {
        const versionPaths = [
            path.join(__dirname, 'VERSION'),
            path.join(__dirname, '..', 'VERSION'),
            path.resolve(process.cwd(), 'VERSION'),
            '/app/VERSION'
        ];

        let currentVersion = '1.2.1-patch.56';

        let foundPath = 'none (fallback)';

        for (const vPath of versionPaths) {
            if (fs.existsSync(vPath)) {
                currentVersion = fs.readFileSync(vPath, 'utf8').trim();
                foundPath = vPath;
                break;
            }
        }

        let latestVersion = currentVersion;
        let updateAvailable = false;
        let dockerReady = true;

        const execPromise = promisify(exec);

        try {
            let stdout = '';
            let retries = 2;
            while (retries > 0) {
                try {
                    const res = await execPromise('curl -sL --connect-timeout 10 https://api.github.com/repos/jsuzanne/stigix/tags');
                    stdout = res.stdout;
                    if (stdout.trim()) break;
                } catch (e) {
                    retries--;
                    if (retries === 0) throw e;
                    await new Promise(r => setTimeout(r, 2000));
                }
            }

            const tagsData = JSON.parse(stdout);
            if (Array.isArray(tagsData) && tagsData.length > 0) {
                const sortedTags = tagsData.map((t: any) => t.name).sort((a: string, b: string) => {
                    const aPatch = a.includes('-patch.');
                    const bPatch = b.includes('-patch.');
                    if (aPatch && !bPatch) return -1;
                    if (!aPatch && bPatch) return 1;
                    const aParts = a.split(/[-.]/);
                    const bParts = b.split(/[-.]/);
                    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
                        const aP = aParts[i] || '';
                        const bP = bParts[i] || '';
                        const aNum = parseInt(aP.replace(/^\D+/, ''));
                        const bNum = parseInt(bP.replace(/^\D+/, ''));
                        if (!isNaN(aNum) && !isNaN(bNum)) {
                            if (bNum !== aNum) return bNum - aNum;
                        } else if (bP !== aP) return bP.localeCompare(aP);
                    }
                    return 0;
                });
                const latestTag = sortedTags[0];
                latestVersion = latestTag.replace(/^v/, '');
                updateAvailable = (latestVersion !== currentVersion);
            }
        } catch (e) {
            if (!githubFetchErrorLogged) {
                log('MAINTENANCE', '⚠️ Failed to fetch latest version from GitHub tags (after retries)', 'warn');
                githubFetchErrorLogged = true;
            }
        }

        if (updateAvailable) {
            try {
                const dockerRepo = 'jsuzanne/sdwan-traffic-gen';
                const { stdout: dockerStatus } = await execPromise(`curl -s -o /dev/null -w "%{http_code}" https://hub.docker.com/v2/repositories/${dockerRepo}/tags/v${latestVersion}/`);
                dockerReady = (dockerStatus.trim() === '200' || dockerStatus.trim() === '403');
            } catch (e) {
                console.warn('[MAINTENANCE] ⚠️ Docker Hub verification failed, assuming ready.');
            }
        }

        res.json({
            current: currentVersion,
            latest: latestVersion,
            updateAvailable,
            dockerReady
        });
    } catch (e: any) {
        console.error('[MAINTENANCE] ❌ Version check error:', e);
        res.status(500).json({ error: 'Failed to check version', details: e.message });
    }
});

// --- Phase 18: Backup & Restore ---

app.get('/api/admin/config/export', authenticateToken, (req, res) => {
    try {
        const configDir = APP_CONFIG.configDir;
        console.log(`[CONFIG] 📦 Starting export from: ${configDir}`);

        if (!fs.existsSync(configDir)) {
            console.error(`[CONFIG] ❌ Export failed: Directory not found at ${configDir}`);
            return res.status(404).json({ error: 'Config directory not found', path: configDir });
        }

        const files = fs.readdirSync(configDir);
        const bundle: Record<string, string> = {};

        console.log(`[CONFIG] Scanning ${files.length} files...`);

        files.forEach(file => {
            // Include only relevant config files
            if ((file.endsWith('.txt') || file.endsWith('.json')) &&
                !file.includes('.backup') &&
                !file.includes('.fixed') &&
                file !== 'test-counter.json') {

                try {
                    const content = fs.readFileSync(path.join(configDir, file), 'utf8');
                    bundle[file] = content;
                } catch (readErr: any) {
                    console.warn(`[CONFIG] ⚠️ Skipping file ${file}: ${readErr.message}`);
                }
            }
        });

        const versionPaths = [
            path.join(__dirname, 'VERSION'),
            path.join(__dirname, '..', 'VERSION'),
            path.resolve(process.cwd(), 'VERSION'),
            '/app/VERSION'
        ];
        let version = '1.1.2-patch.8';
        for (const vPath of versionPaths) {
            if (fs.existsSync(vPath)) {
                version = fs.readFileSync(vPath, 'utf8').trim();
                break;
            }
        }

        console.log(`[CONFIG] ✅ Export complete: ${Object.keys(bundle).length} files bundled.`);

        res.json({
            version,
            timestamp: new Date().toISOString(),
            files: bundle
        });
    } catch (e: any) {
        console.error('[CONFIG] ❌ Export failed:', e);
        res.status(500).json({ error: 'Export failed: ' + e.message, details: e.stack });
    }
});

app.post('/api/admin/config/import', authenticateToken, async (req, res) => {
    const { bundle } = req.body;
    if (!bundle || !bundle.files) {
        return res.status(400).json({ error: 'Invalid configuration bundle' });
    }

    try {
        const configDir = APP_CONFIG.configDir;
        const backupDir = path.join(configDir, '.pre-import-backup-' + Date.now());

        // 1. Snapshot current config
        fs.mkdirSync(backupDir, { recursive: true });
        const currentFiles = fs.readdirSync(configDir);
        currentFiles.forEach(file => {
            const fullPath = path.join(configDir, file);
            if (fs.lstatSync(fullPath).isFile()) {
                fs.copyFileSync(fullPath, path.join(backupDir, file));
            }
        });

        // 2. Apply new config
        console.log(`[CONFIG] Importing ${Object.keys(bundle.files).length} files...`);
        for (const [filename, content] of Object.entries(bundle.files)) {
            // Security check: only allow specific file types and prevent path traversal
            if ((filename.endsWith('.txt') || filename.endsWith('.json')) && !filename.includes('/') && !filename.includes('\\')) {
                fs.writeFileSync(path.join(configDir, filename), content as string, 'utf8');
            }
        }

        res.json({ success: true, message: 'Configuration restored. Restarting system...' });

        // 3. Restart to apply
        setTimeout(() => {
            console.log('[CONFIG] 🔄 Restarting for configuration shift...');
            process.exit(0);
        }, 2000);

    } catch (e: any) {
        res.status(500).json({ error: 'Import failed', message: e.message });
    }
});

app.get('/api/admin/maintenance/status', authenticateToken, (req, res) => {
    res.json(G_UPGRADE_STATUS);
});

app.post('/api/admin/maintenance/upgrade', authenticateToken, async (req, res) => {
    const { version } = req.body;

    if (G_UPGRADE_STATUS.inProgress) {
        return res.status(400).json({ error: 'Upgrade already in progress' });
    }

    // Initialize status
    G_UPGRADE_STATUS = {
        inProgress: true,
        version: version || 'latest',
        stage: 'pulling',
        logs: [`[${new Date().toISOString()}] Upgrade requested to ${version || 'latest'}`],
        error: null,
        startTime: Date.now()
    };

    const pullTarget = version || 'stable';

    const rootDir = PROJECT_ROOT;

    res.json({ success: true, message: 'Upgrade started in background' });

    const runUpgrade = async () => {
        try {
            const pullCmd = fs.existsSync(path.join(rootDir, 'docker-compose.yml'))
                ? (version ? `TAG=${version} docker compose pull` : 'docker compose pull')
                : `docker pull jsuzanne/sdwan-web-ui:${pullTarget} && docker pull jsuzanne/sdwan-traffic-gen:${pullTarget} && docker pull jsuzanne/sdwan-voice-gen:${pullTarget} && docker pull jsuzanne/sdwan-voice-echo:${pullTarget}`;

            G_UPGRADE_STATUS.logs.push(`[${new Date().toISOString()}] Executing: ${pullCmd}`);

            const pullProcess = spawn('sh', ['-c', pullCmd], { cwd: rootDir });

            pullProcess.stdout.on('data', (data: any) => {
                const line = data.toString().trim();
                if (line) G_UPGRADE_STATUS.logs.push(line);
                if (G_UPGRADE_STATUS.logs.length > 50) G_UPGRADE_STATUS.logs.shift();
            });

            pullProcess.stderr.on('data', (data: any) => {
                const line = data.toString().trim();
                if (line) G_UPGRADE_STATUS.logs.push(`[WARN] ${line}`);
            });

            const pullExitCode = await new Promise((resolve) => {
                pullProcess.on('close', resolve);
            });

            if (pullExitCode !== 0) {
                throw new Error(`Pull failed with exit code ${pullExitCode}`);
            }

            G_UPGRADE_STATUS.stage = 'restarting';
            G_UPGRADE_STATUS.logs.push(`[${new Date().toISOString()}] Pull complete. Refreshing services...`);

            // Short delay before restart
            setTimeout(async () => {
                try {
                    // Start by checking if we have compose file
                    if (fs.existsSync(path.join(rootDir, 'docker-compose.yml'))) {
                        G_UPGRADE_STATUS.logs.push(`[${new Date().toISOString()}] Running: docker compose up -d`);
                        execSync('docker compose up -d', { cwd: rootDir });
                    } else if (fs.existsSync('/app/docker-compose.yml')) {
                        G_UPGRADE_STATUS.logs.push(`[${new Date().toISOString()}] Running: docker compose up -d`);
                        execSync('docker compose up -d', { cwd: '/app' });
                    } else {
                        // Fallback: forcefully restart containers by name if no compose file is mapped
                        G_UPGRADE_STATUS.logs.push(`[${new Date().toISOString()}] No compose file found, falling back to docker run/restart`);
                        try {
                            // This is a best-effort fallback if docker-compose up -d is not available
                            // Usually, watchtower or similar is better for pure docker upgrades
                            execSync('docker restart sdwan-traffic-gen sdwan-voice-gen sdwan-web-ui');
                        } catch (e) {
                            G_UPGRADE_STATUS.logs.push(`[WARN] Fallback restart failed: ${e}`);
                        }
                    }

                    G_UPGRADE_STATUS.stage = 'complete';
                    G_UPGRADE_STATUS.logs.push(`[${new Date().toISOString()}] ✅ Upgrade complete. Restarting dashboard...`);

                    setTimeout(() => process.exit(0), 1000);
                } catch (e: any) {
                    G_UPGRADE_STATUS.stage = 'failed';
                    G_UPGRADE_STATUS.error = e.message;
                    G_UPGRADE_STATUS.inProgress = false;
                }
            }, 2000);

        } catch (e: any) {
            console.error('[MAINTENANCE] Upgrade failed:', e);
            G_UPGRADE_STATUS.inProgress = false;
            G_UPGRADE_STATUS.stage = 'failed';
            G_UPGRADE_STATUS.error = e.message;
            G_UPGRADE_STATUS.logs.push(`[ERROR] ${e.message}`);
        }
    };

    runUpgrade();
});

app.post('/api/admin/maintenance/restart', authenticateToken, async (req, res) => {
    const { type } = req.body; // 'restart' or 'redeploy'

    if (G_UPGRADE_STATUS.inProgress) {
        return res.status(400).json({ error: 'Maintenance in progress' });
    }

    // Initialize status for UI tracking
    G_UPGRADE_STATUS = {
        inProgress: true,
        version: 'restart',
        stage: 'restarting',
        logs: [`[${new Date().toISOString()}] System ${type === 'redeploy' ? 'Reload' : 'Restart'} requested`],
        error: null,
        startTime: Date.now()
    };


    const rootDir = PROJECT_ROOT;

    res.json({ success: true, message: 'Restart sequence initiated' });

    const runRestart = async () => {
        try {
            // First check if /app/docker-compose.yml exists (mounted in prod)
            const hasAppCompose = fs.existsSync('/app/docker-compose.yml');
            const hasRootCompose = fs.existsSync(path.join(rootDir, 'docker-compose.yml'));
            const composeFile = hasAppCompose ? '/app/docker-compose.yml' : (hasRootCompose ? path.join(rootDir, 'docker-compose.yml') : null);

            let cmd = '';

            if (composeFile) {
                // Try 'docker compose' first, then 'docker-compose'
                let baseCmd = 'docker compose';
                try {
                    // 'which' is a reliable way to check for binary existence
                    await promisify(exec)('which docker-compose');
                    baseCmd = 'docker-compose';
                } catch (e) {
                    try {
                        await promisify(exec)('docker compose version');
                        baseCmd = 'docker compose';
                    } catch (e2) {
                        throw new Error('Neither "docker-compose" nor "docker compose" were found in the container.');
                    }
                }
                cmd = type === 'redeploy'
                    ? `${baseCmd} -f ${composeFile} up -d`
                    : `${baseCmd} -f ${composeFile} restart`;
            } else {
                // Fallback to pure docker commands based on typical container names
                cmd = type === 'redeploy'
                    // Redeploy without compose might not pick up new envs, but restarting helps 
                    ? `docker restart sdwan-traffic-gen sdwan-voice-gen sdwan-web-ui`
                    : `docker restart sdwan-traffic-gen sdwan-voice-gen sdwan-web-ui`;
            }

            G_UPGRADE_STATUS.logs.push(`[${new Date().toISOString()}] Executing: ${cmd}`);

            const restartProcess = spawn('sh', ['-c', cmd], { cwd: rootDir });

            restartProcess.stdout.on('data', (data: any) => {
                const line = data.toString().trim();
                if (line) G_UPGRADE_STATUS.logs.push(line);
            });

            restartProcess.stderr.on('data', (data: any) => {
                const line = data.toString().trim();
                if (line) {
                    G_UPGRADE_STATUS.logs.push(`[INFO] ${line}`);
                    console.log(`[MAINTENANCE-INFO] ${line}`);
                }
            });

            const exitCode = await new Promise((resolve) => {
                restartProcess.on('close', resolve);
            });

            if (exitCode !== 0) {
                throw new Error(`Command failed with exit code ${exitCode}. Check logs for details.`);
            }

            G_UPGRADE_STATUS.logs.push(`[${new Date().toISOString()}] ✅ Sequence complete.`);

            if (type === 'redeploy') {
                // If we redeployed, we might need to kill ourselves to ensure we pick up changes if our own container was recreated (it will kill us anyway)
                G_UPGRADE_STATUS.stage = 'complete';
                // Wait a moment for logs to flush then exit if we are still alive
                setTimeout(() => process.exit(0), 1000);
            } else {
                G_UPGRADE_STATUS.stage = 'complete';
                // For simple restart, we might wait for services to come back. 
                // If 'docker compose restart' restarts US, we die here.
            }

        } catch (e: any) {
            console.error('[MAINTENANCE] Restart failed:', e);
            G_UPGRADE_STATUS.inProgress = false;
            G_UPGRADE_STATUS.stage = 'failed';
            G_UPGRADE_STATUS.error = e.message;
            G_UPGRADE_STATUS.logs.push(`[ERROR] ${e.message}`);
        }
    };

    // Run slightly delayed to allow response to flush
    setTimeout(runRestart, 500);
});

// Schedule daily log cleanup (runs at 2 AM)
const scheduleLogCleanup = () => {
    const now = new Date();
    const tomorrow2AM = new Date(now);
    tomorrow2AM.setDate(tomorrow2AM.getDate() + 1);
    tomorrow2AM.setHours(2, 0, 0, 0);

    const msUntil2AM = tomorrow2AM.getTime() - now.getTime();

    setTimeout(async () => {
        console.log('[LOG_CLEANUP] Running daily log cleanup...');
        const deletedCount = await testLogger.cleanup();
        console.log(`[LOG_CLEANUP] Deleted ${deletedCount} old log files`);

        // Schedule next cleanup
        scheduleLogCleanup();
    }, msUntil2AM);
    console.log(`[LOG_CLEANUP] Next cleanup scheduled for ${tomorrow2AM.toISOString()}`);
};


// --- Slow App / SRT Simulation (REMOVED) ---

// --- IoT Devices API ---

app.get('/api/iot/devices', authenticateToken, (req, res) => {
    const devices = getIoTDevices();

    // Logger uniquement en mode DEBUG
    if (process.env.DEBUG_IOT === 'true') {
        log('IOT-REQ', `GET /api/iot/devices - Found ${devices.length} devices`, 'debug');
    }
    const running = iotManager.getRunningDevices();
    const result = devices.map(d => ({
        ...d,
        running: running.includes(d.id),
        status: iotManager.getDeviceStatus(d.id)
    }));
    res.json(result);
});

app.post('/api/iot/devices', authenticateToken, (req, res) => {
    const devices = getIoTDevices();
    const newDevice = req.body;

    if (!newDevice.id) return res.status(400).json({ error: 'Device ID is required' });

    const index = devices.findIndex(d => d.id === newDevice.id);
    if (index !== -1) {
        devices[index] = { ...devices[index], ...newDevice };
    } else {
        devices.push(newDevice);
    }

    saveIoTDevices(devices);
    res.json({ success: true, device: newDevice });
});

app.delete('/api/iot/devices/:id', authenticateToken, (req, res) => {
    let devices = getIoTDevices();
    const id = req.params.id;

    if (iotManager.getRunningDevices().includes(id)) {
        return res.status(400).json({ error: 'Cannot delete a running device' });
    }

    devices = devices.filter(d => d.id !== id);
    saveIoTDevices(devices);
    res.json({ success: true });
});

// --- Local Registry API (Hybrid Leader) ---
let localRegistryServer: LocalRegistryServer | null = null;
if (process.env.STIGIX_REGISTRY_MODE === 'leader') {
    localRegistryServer = new LocalRegistryServer();
    app.use('/api/registry', localRegistryServer.getRouter());
    log('REGISTRY', `🏠 Local Registry Server mounted at /api/registry`);
}

// Global Registry Status
app.get('/api/registry/status', authenticateToken, (req, res) => {
    const status: any = {
        ...registryManager.getStatus(),
        mode: process.env.STIGIX_REGISTRY_MODE || 'peer',
        local_registry_active: process.env.STIGIX_REGISTRY_MODE === 'leader'
    };

    if (localRegistryServer) {
        status.local_instances = localRegistryServer.getInstances();
    }

    res.json(status);
});

app.post('/api/iot/start-batch', authenticateToken, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'IDs array required' });

    const config = getIoTConfig();
    const devices = config.devices;
    const gateway = config.network?.gateway;
    const toStart = devices.filter(d => ids.includes(d.id));

    for (const device of toStart) {
        // Inject gateway from network config
        const deviceWithGateway = { ...device, gateway };
        iotManager.startDevice(deviceWithGateway).catch(err => console.error(`Failed to start ${device.id}:`, err));
    }

    res.json({ success: true, started: toStart.length });
});

app.post('/api/iot/stop-batch', authenticateToken, async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'IDs array required' });

    for (const id of ids) {
        iotManager.stopDevice(id);
    }

    res.json({ success: true, stopped: ids.length });
});

app.post('/api/iot/start/:id', authenticateToken, async (req, res) => {
    const config = getIoTConfig();
    const device = config.devices.find(d => d.id === req.params.id);
    const gateway = config.network?.gateway;

    if (!device) return res.status(404).json({ error: 'Device not found' });

    try {
        // Inject gateway from network config
        const deviceWithGateway = { ...device, gateway };
        await iotManager.startDevice(deviceWithGateway);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/iot/stop/:id', authenticateToken, async (req, res) => {
    await iotManager.stopDevice(req.params.id);
    res.json({ success: true });
});

app.get('/api/iot/stats', authenticateToken, (req, res) => {
    res.json(iotManager.getAllStats());
});

app.get('/api/iot/config/export', authenticateToken, (req, res) => {
    try {
        const config = getIoTConfig();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="iot-devices.json"');
        res.send(JSON.stringify(config, null, 2));
    } catch (err: any) {
        res.status(500).json({ error: 'Export failed', details: err?.message });
    }
});

app.post('/api/iot/config/import', authenticateToken, (req, res) => {
    console.log('[IOT-REQ] POST /api/iot/config/import started');
    try {
        const { content } = req.body;
        if (!content) {
            console.warn('[IOT-REQ] Import aborted: Empty content');
            return res.status(400).json({ error: 'No content provided' });
        }

        const config = typeof content === 'string' ? JSON.parse(content) : content;
        console.log(`[IOT-REQ] Parsing content (Type: ${typeof config}, Keys: ${Object.keys(config).join(',')})`);

        // Basic validation
        if (!config.devices || !Array.isArray(config.devices)) {
            // Fallback: if it's just an array, wrap it in a default config
            if (Array.isArray(config)) {
                console.log(`[IOT-REQ] LEGACY DETECTED: Importing flat array of ${config.length} devices`);
                saveIoTConfig({ network: { interface: 'eth0' }, devices: config });
                return res.json({ success: true, message: 'Legacy IoT devices imported successfully' });
            }
            console.error('[IOT-REQ] Import failed: Invalid structure');
            return res.status(400).json({ error: 'Invalid config: missing devices array' });
        }

        // Backup current file
        if (fs.existsSync(IOT_DEVICES_FILE)) {
            const backupFile = IOT_DEVICES_FILE + '.backup';
            fs.copyFileSync(IOT_DEVICES_FILE, backupFile);
            console.log(`[IOT-REQ] Config backup created: ${backupFile}`);
        }

        console.log(`[IOT-REQ] Success: Importing structured config with ${config.devices.length} devices`);
        saveIoTConfig(config);
        res.json({ success: true, message: 'IoT configuration imported successfully' });
    } catch (err: any) {
        console.error('[IOT-REQ] FATAL Import error:', err.message);
        res.status(500).json({ error: 'Import failed', details: err?.message });
    }
});


if (process.env.NODE_ENV === 'production') {
    // Static files
    app.use(express.static(path.join(__dirname, 'dist')));

    // SPA Fallback - Use middleware as last resort
    app.use((req, res) => {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
}

httpServer.listen(PORT, async () => {
    // Initialize platform-specific commands
    await initializeCommands();

    // Performance log healing
    healLogFiles();

    // Log version on startup
    try {
        const versionFile = path.join(__dirname, 'VERSION');
        if (fs.existsSync(versionFile)) {
            const version = fs.readFileSync(versionFile, 'utf8').trim();
            console.log(`🚀 SD-WAN Traffic Generator ${version}`);
        }
    } catch (e) { }

    // Start cleanup scheduler
    scheduleLogCleanup();

    // Smoke Test: Validate all Express routes to catch PathError regressions early


    console.log(`Backend running at http://localhost:${PORT}`);
});
