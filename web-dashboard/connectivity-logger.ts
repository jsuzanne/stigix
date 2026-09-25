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
            await this.rotateIfNeeded();
            const line = JSON.stringify(result) + '\n';
            await appendFile(this.currentLogFile, line, 'utf8');
            // Invalidate stats cache so the next request reflects fresh data
            this.statsCache = null;
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

    private statsCache: { data: any, timestamp: number, range: string } | null = null;

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

    async getResults(options: { limit?: number; offset?: number; type?: string; endpointId?: string; timeRange?: string } = {}): Promise<{ results: ConnectivityResult[]; total: number }> {
        try {
            const cutoff = this.parseTimeRangeCutoff(options.timeRange);

            // If we have a strict limit and no specific time range required for the query results specifically
            // (other than general retention), we can optimize reading.
            const allResults = await this.readAllResults(options.limit ? (options.limit + (options.offset || 0)) * 2 : undefined, cutoff);
            let filtered = allResults;

            if (options.type) filtered = filtered.filter(r => r.endpointType === options.type);
            if (options.endpointId) filtered = filtered.filter(r => r.endpointId === options.endpointId);

            // Time range filter is already partially applied in readAllResults, but let's be precise
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
        // Cache aligned with probe interval (5 minutes) — invalidated on each logResult()
        const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
        const now = Date.now();
        const cacheRange = options.timeRange || '24h';
        if (this.statsCache && (now - this.statsCache.timestamp < STATS_CACHE_TTL) && (this.statsCache.range === cacheRange)) {
            return this.statsCache.data;
        }

        try {
            const cutoff = this.parseTimeRangeCutoff(options.timeRange);

            const allResults = await this.readAllResults(undefined, cutoff);
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
                const stats = endpointStats.get(r.endpointId) || { 
                    name: r.endpointName, 
                    type: r.type,
                    target: r.target,
                    count: 0, 
                    success: 0, 
                    totalScore: 0,
                    lastError: r.error,
                    lastLatency: r.latency
                };
                stats.count++;
                if (r.reachable) stats.success++;
                if (r.error && !stats.lastError) stats.lastError = r.error;
                if (r.type && !stats.type) stats.type = r.type;
                if (r.target && !stats.target) stats.target = r.target;
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

            this.statsCache = { data: computedStats, timestamp: now, range: cacheRange };
            return computedStats;
        } catch (error) {
            log('CONNECTIVITY_LOGGER', `Failed to compute stats: ${error}`, 'error');
            return null;
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
                
                // If the entire file is older than our cutoff, skip it
                if (minTimestamp && stats.mtimeMs < minTimestamp) continue;

                // For large files, we still want to read from the end.
                // Simple optimization: if the file is small, read it all. 
                // If large, we'd ideally use a stream or read-from-end buffer, 
                // but for now, we'll just parse lines more carefully.
                const content = await readFile(filePath, 'utf8');
                const lines = content.trim().split('\n').reverse(); // Newest lines first

                let staleInARow = 0;
                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const result = JSON.parse(line) as ConnectivityResult;
                        if (minTimestamp && result.timestamp < minTimestamp) {
                            staleInARow++;
                            // If we see 5 lines in a row (newest-first) that are older than our cutoff,
                            // the rest of this file (and older files) are definitely too old.
                            if (staleInARow > 5) break; 
                            continue;
                        }
                        staleInARow = 0;
                        allResults.push(result);
                        if (maxResults && allResults.length >= maxResults) return allResults;
                    } catch (e) { }
                }
                
                if (minTimestamp && staleInARow > 5) break;
            }
            return allResults;
        } catch (error) {
            return [];
        }
    }
}
