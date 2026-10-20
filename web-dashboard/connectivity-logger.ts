import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { log } from './utils/logger.js';

const appendFile = promisify(fs.appendFile);
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

export interface ConnectivityResult {
    timestamp: number;
    endpointId: string;
    endpointName: string;
    endpointType: 'HTTP' | 'HTTPS' | 'PING' | 'TCP' | 'UDP' | 'DNS' | 'CLOUD';
    url: string;
    reachable: boolean;
    httpCode?: number;
    remoteIp?: string;
    remotePort?: number;
    peer_instance_id?: string;
    metrics: {
        dns_ms?: number;
        tcp_ms?: number;
        tls_ms?: number;
        ttfb_ms?: number;
        total_ms: number;
        jitter_ms?: number;
        loss_pct?: number;
        size_bytes?: number;
        speed_bps?: number;
        ssl_verify?: number;
    };
    score: number;
    data?: any; // Rich scenario info (e.g. for Egress Info)
    // Optional content matching result fields (HTTP/HTTPS probes only)
    content_match_enabled?: boolean;
    content_match_mode?: 'contains' | 'not_contains';
    content_match_value?: string;
    content_match_result?: string;
    content_match_ok?: boolean;
}

export class ConnectivityLogger {
    private logDir: string;
    private retentionDays: number;
    private maxLogSizeMB: number;
    private currentLogFile: string;

    constructor(logDir: string, retentionDays: number = 7, maxLogSizeMB: number = 100) {
        this.logDir = logDir;
        this.retentionDays = retentionDays;
        this.maxLogSizeMB = maxLogSizeMB;
        this.currentLogFile = path.join(logDir, 'connectivity-results.jsonl');

        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    async logResult(result: ConnectivityResult): Promise<void> {
        try {
            await this.ensureInitialized();
            await this.rotateIfNeeded();
            const line = JSON.stringify(result) + '\n';
            await appendFile(this.currentLogFile, line, 'utf8');

            // Prepend new result to in-memory ring buffer (newest first)
            this.memoryResults.unshift(result);
            if (this.memoryResults.length > this.MAX_IN_MEMORY) {
                this.memoryResults.pop();
            }
            if (result.endpointId) this.latestByEndpoint.set(result.endpointId, result);
            if (result.endpointName) this.latestByEndpoint.set(result.endpointName, result);

            // Note: statsCache uses a 5s TTL in getStats(); do not wipe it on every probe write
        } catch (error) {
            log('CONNECTIVITY_LOGGER', `Failed to log result: ${error}`, 'error');
        }
    }

    private async rotateIfNeeded(): Promise<void> {
        try {
            if (!fs.existsSync(this.currentLogFile)) return;
            const stats = await stat(this.currentLogFile);
            if (stats.size / (1024 * 1024) >= this.maxLogSizeMB) {
                const timestamp = new Date().toISOString().split('T')[0];
                let counter = 1;
                let rotatedFile = path.join(this.logDir, `connectivity-results-${timestamp}.jsonl`);
                while (fs.existsSync(rotatedFile)) {
                    rotatedFile = path.join(this.logDir, `connectivity-results-${timestamp}-${counter}.jsonl`);
                    counter++;
                }
                fs.renameSync(this.currentLogFile, rotatedFile);
                log('CONNECTIVITY_LOGGER', `Rotated log file to: ${rotatedFile}`);
            }
        } catch (error) {
            log('CONNECTIVITY_LOGGER', `Failed to rotate log: ${error}`, 'error');
        }
    }

    async cleanup(): Promise<number> {
        try {
            const files = await readdir(this.logDir);
            const logFiles = files.filter((f: string) => f.startsWith('connectivity-results') && f.endsWith('.jsonl'));
            const cutoffDate = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
            let deletedCount = 0;
            for (const file of logFiles) {
                const filePath = path.join(this.logDir, file);
                const stats = await stat(filePath);
                if (stats.mtimeMs < cutoffDate) {
                    await unlink(filePath);
                    deletedCount++;
                }
            }
            return deletedCount;
        } catch (error) {
            log('CONNECTIVITY_LOGGER', `Failed to cleanup logs: ${error}`, 'error');
            return 0;
        }
    }

    private statsCache: Map<string, { data: any, timestamp: number }> = new Map();
    private memoryResults: ConnectivityResult[] = [];
    private latestByEndpoint: Map<string, ConnectivityResult> = new Map();
    private readonly MAX_IN_MEMORY = 15000;
    private memoryCoversFullTail: boolean = false;
    private initialized: boolean = false;
    private initPromise: Promise<void> | null = null;

    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                if (fs.existsSync(this.currentLogFile)) {
                    const tail = await this.loadTailFromFile(this.currentLogFile, this.MAX_IN_MEMORY);
                    this.memoryResults = tail.results;
                    for (const r of this.memoryResults) {
                        if (r.endpointId && !this.latestByEndpoint.has(r.endpointId)) {
                            this.latestByEndpoint.set(r.endpointId, r);
                        }
                        if (r.endpointName && !this.latestByEndpoint.has(r.endpointName)) {
                            this.latestByEndpoint.set(r.endpointName, r);
                        }
                    }
                }
                this.memoryCoversFullTail = true;
            } catch (err) {
                log('CONNECTIVITY_LOGGER', `Failed to initialize memory buffer: ${err}`, 'error');
            } finally {
                this.initialized = true;
            }
        })();

        return this.initPromise;
    }

    async getLatestResult(idOrName: string): Promise<ConnectivityResult | undefined> {
        await this.ensureInitialized();
        return this.latestByEndpoint.get(idOrName);
    }

    private parseTimeRangeCutoff(timeRange?: string): number {
        if (!timeRange) return 0;
        const now = Date.now();
        const match = timeRange.match(/^(\d+)([mhd])$/i);
        if (match) {
            const val = parseInt(match[1], 10);
            const unit = match[2].toLowerCase();
            if (unit === 'm') return now - val * 60 * 1000;
            if (unit === 'h') return now - val * 3600 * 1000;
            if (unit === 'd') return now - val * 24 * 3600 * 1000;
        }
        return 0;
    }

    private async getEffectiveResults(maxResults?: number, minTimestamp?: number): Promise<ConnectivityResult[]> {
        await this.ensureInitialized();

        const hasData = this.memoryResults.length > 0;
        const oldestMemoryTs = hasData ? this.memoryResults[this.memoryResults.length - 1].timestamp : Infinity;

        // Check if the in-memory ring buffer covers the request or already holds the full 4MB tail chunk
        const coversTimeRange = minTimestamp !== undefined && minTimestamp > 0 && hasData && oldestMemoryTs <= minTimestamp;
        const coversCount = maxResults !== undefined && this.memoryResults.length >= maxResults;

        if (coversTimeRange || coversCount || this.memoryCoversFullTail) {
            if (minTimestamp && minTimestamp > 0) {
                const filtered = this.memoryResults.filter(r => r.timestamp >= minTimestamp);
                return maxResults && filtered.length > maxResults ? filtered.slice(0, maxResults) : filtered;
            }
            return maxResults ? this.memoryResults.slice(0, maxResults) : this.memoryResults;
        }

        // Fall back to reading from disk
        return this.readAllResults(maxResults, minTimestamp);
    }

    async getResults(options: { limit?: number; offset?: number; type?: string; endpointId?: string; timeRange?: string } = {}): Promise<{ results: ConnectivityResult[]; total: number }> {
        try {
            const cutoff = this.parseTimeRangeCutoff(options.timeRange);

            const allResults = await this.getEffectiveResults(
                options.limit ? (options.limit + (options.offset || 0)) * 2 : undefined, 
                cutoff
            );
            let filtered = allResults;

            if (options.type) filtered = filtered.filter(r => r.endpointType === options.type);
            if (options.endpointId) filtered = filtered.filter(r => r.endpointId === options.endpointId);

            // Time range filter is already partially applied, but ensure precision
            if (cutoff > 0) filtered = filtered.filter(r => r.timestamp >= cutoff);

            filtered.sort((a, b) => b.timestamp - a.timestamp);
            const offset = options.offset || 0;
            const limit = options.limit || 100;
            return {
                results: filtered.slice(offset, offset + limit),
                total: filtered.length
            };
        } catch (error) {
            log('CONNECTIVITY_LOGGER', `Failed to get results: ${error}`, 'error');
            return { results: [], total: 0 };
        }
    }

    async getStats(options: { timeRange?: string, activeProbeIds?: string[], globalScoreTypes?: string[] } = {}): Promise<any> {
        // Cache aligned with probe interval (5 seconds TTL), keyed per timeRange + filter signature
        const STATS_CACHE_TTL = 5 * 1000;
        const now = Date.now();
        const cacheRange = options.timeRange || '24h';
        const cacheKey = `${cacheRange}:${(options.activeProbeIds || []).length}:${(options.globalScoreTypes || []).join(',')}`;
        const cached = this.statsCache.get(cacheKey);
        if (cached && (now - cached.timestamp < STATS_CACHE_TTL)) {
            return cached.data;
        }

        try {
            const cutoff = this.parseTimeRangeCutoff(options.timeRange);

            const allResults = await this.getEffectiveResults(undefined, cutoff);
            if (allResults.length === 0) return null;

            let filtered = allResults;
            if (cutoff > 0) filtered = filtered.filter(r => r.timestamp >= cutoff);

            if (filtered.length === 0) return {
                globalHealth: 0,
                httpEndpoints: { total: 0, avgScore: 0, minScore: 0, maxScore: 0 },
                flakyEndpoints: [],
                lastCheckTime: allResults.length > 0 ? allResults[0].timestamp : null
            };

            // Filter results by selected probe types (default: all types)
            const scoreTypes = (options.globalScoreTypes && options.globalScoreTypes.length > 0)
                ? options.globalScoreTypes
                : ['HTTP', 'HTTPS', 'PING', 'DNS', 'UDP', 'TCP', 'CLOUD'];

            const scoreResults = filtered.filter(r => scoreTypes.includes(r.endpointType));

            // Filter scoreResults to only include active probes
            const activeScoreResults = options.activeProbeIds
                ? scoreResults.filter(r => options.activeProbeIds!.includes(r.endpointId))
                : scoreResults;

            // HTTP Coverage count (always HTTP/HTTPS regardless of score types)
            const httpResults = filtered.filter(r => r.endpointType === 'HTTP' || r.endpointType === 'HTTPS');
            const activeHttpResults = options.activeProbeIds
                ? httpResults.filter(r => options.activeProbeIds!.includes(r.endpointId))
                : httpResults;
            const uniqueHttpEndpoints = new Set(activeHttpResults.map(r => r.endpointId)).size;

            // Group by endpoint to find flaky / down ones (all types)
            const endpointStats = new Map<string, { 
                name: string, 
                type?: string,
                target?: string,
                count: number, 
                success: number, 
                totalScore: number,
                lastError?: string,
                lastLatency?: number
            }>();
            filtered.forEach(r => {
                const rType = r.endpointType || (r as any).type;
                const rTarget = r.url || (r as any).target;
                const rLatency = r.metrics?.total_ms ?? (r as any).latency;
                const stats = endpointStats.get(r.endpointId) || { 
                    name: r.endpointName, 
                    type: rType,
                    target: rTarget,
                    count: 0, 
                    success: 0, 
                    totalScore: 0,
                    lastError: r.error,
                    lastLatency: rLatency
                };
                stats.count++;
                if (r.reachable) stats.success++;
                if (r.error && !stats.lastError) stats.lastError = r.error;
                if (rType && !stats.type) stats.type = rType;
                if (rTarget && !stats.target) stats.target = rTarget;
                stats.totalScore += r.score;
                endpointStats.set(r.endpointId, stats);
            });

            const flakyEndpoints = Array.from(endpointStats.entries())
                .filter(([id, _]) => !options.activeProbeIds || options.activeProbeIds.includes(id))
                .map(([id, stats]) => ({
                    id,
                    name: stats.name,
                    type: (stats.type || 'HTTP').toUpperCase(),
                    target: stats.target,
                    lastError: stats.lastError || (stats.success === 0 ? 'Probe unreachable (100% loss)' : 'Intermittent timeouts / drops'),
                    reliability: Math.round((stats.success / stats.count) * 100),
                    avgScore: Math.round(stats.totalScore / stats.count),
                    isDown: stats.success === 0
                }))
                .filter(e => e.reliability < 95 || e.avgScore < 70)
                .sort((a, b) => (a.reliability + a.avgScore) - (b.reliability + b.avgScore))
                .slice(0, 5);

            const computedStats = {
                globalHealth: activeScoreResults.length > 0
                    ? Math.round(activeScoreResults.reduce((acc, r) => acc + (r.score || 0), 0) / activeScoreResults.length)
                    : 0,
                globalScoreTypes: scoreTypes,
                httpEndpoints: {
                    total: uniqueHttpEndpoints,
                    avgScore: activeHttpResults.length > 0 ? Math.round(activeHttpResults.reduce((acc, r) => acc + (r.score || 0), 0) / activeHttpResults.length) : 0,
                    minScore: activeHttpResults.length > 0 ? Math.min(...activeHttpResults.map(r => r.score || 0)) : 0,
                    maxScore: activeHttpResults.length > 0 ? Math.max(...activeHttpResults.map(r => r.score || 0)) : 0
                },
                flakyEndpoints,
                lastCheckTime: allResults.length > 0 ? allResults[0].timestamp : null
            };

            this.statsCache.set(cacheKey, { data: computedStats, timestamp: now });
            return computedStats;
        } catch (error) {
            log('CONNECTIVITY_LOGGER', `Failed to compute stats: ${error}`, 'error');
            return null;
        }
    }

    private async loadTailFromFile(filePath: string, maxResults: number, minTimestamp?: number): Promise<{ results: ConnectivityResult[], reachedBeginning: boolean }> {
        try {
            const fileStat = await stat(filePath);
            if (fileStat.size === 0) return { results: [], reachedBeginning: true };

            const chunkSize = Math.min(fileStat.size, 4 * 1024 * 1024);
            const reachedBeginning = chunkSize === fileStat.size;

            const buffer = Buffer.alloc(chunkSize);
            const fd = fs.openSync(filePath, 'r');
            try {
                fs.readSync(fd, buffer, 0, chunkSize, fileStat.size - chunkSize);
            } finally {
                fs.closeSync(fd);
            }

            let text = buffer.toString('utf8');
            if (!reachedBeginning) {
                const firstNewline = text.indexOf('\n');
                if (firstNewline !== -1) {
                    text = text.slice(firstNewline + 1);
                }
            }

            const lines = text.trim().split('\n').reverse(); // Newest first
            const results: ConnectivityResult[] = [];
            let staleInARow = 0;

            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const result = JSON.parse(line) as ConnectivityResult;
                    if (minTimestamp && result.timestamp < minTimestamp) {
                        staleInARow++;
                        if (staleInARow > 5) break;
                        continue;
                    }
                    staleInARow = 0;
                    results.push(result);
                    if (maxResults && results.length >= maxResults) break;
                } catch {
                    // Ignore malformed lines
                }
            }

            return { results, reachedBeginning };
        } catch (error) {
            log('CONNECTIVITY_LOGGER', `Failed to load tail from ${filePath}: ${error}`, 'error');
            return { results: [], reachedBeginning: true };
        }
    }

    private async readAllResults(maxResults?: number, minTimestamp?: number): Promise<ConnectivityResult[]> {
        try {
            const files = await readdir(this.logDir);
            const logFiles = files
                .filter((f: string) => f.startsWith('connectivity-results') && f.endsWith('.jsonl'))
                .sort()
                .reverse(); // Newest first

            const allResults: ConnectivityResult[] = [];

            for (const file of logFiles) {
                const filePath = path.join(this.logDir, file);
                const stats = await stat(filePath);

                // If the entire file was modified before our cutoff, skip it
                if (minTimestamp && stats.mtimeMs < minTimestamp) continue;

                const needed = maxResults ? maxResults - allResults.length : 15000;
                const tail = await this.loadTailFromFile(filePath, needed, minTimestamp);
                allResults.push(...tail.results);

                if (maxResults && allResults.length >= maxResults) {
                    return allResults.slice(0, maxResults);
                }

                // If this file had records older than minTimestamp, older files will be even older
                if (minTimestamp && tail.results.some(r => r.timestamp < minTimestamp)) {
                    break;
                }
            }
            return allResults;
        } catch (error) {
            log('CONNECTIVITY_LOGGER', `Failed to read all results: ${error}`, 'error');
            return [];
        }
    }
}
