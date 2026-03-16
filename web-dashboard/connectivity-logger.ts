import fs from 'fs';
import path from 'path';
import readline from 'readline';
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

    async getResults(options: { limit?: number; offset?: number; type?: string; endpointId?: string; timeRange?: string } = {}): Promise<{ results: ConnectivityResult[]; total: number }> {
        try {
            const now = Date.now();
            let cutoff = 0;
            if (options.timeRange) {
                if (options.timeRange === '1h') cutoff = now - 3600000;
                else if (options.timeRange === '6h') cutoff = now - 6 * 3600000;
                else if (options.timeRange === '24h') cutoff = now - 24 * 3600000;
                else if (options.timeRange === '7d') cutoff = now - 7 * 24 * 3600000;
            }

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

    async getStats(options: { timeRange?: string, activeProbeIds?: string[] } = {}): Promise<any> {
        // Cache aligned with probe interval (5 minutes) — invalidated on each logResult()
        const STATS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
        const now = Date.now();
        const cacheRange = options.timeRange || '24h';
        if (this.statsCache && (now - this.statsCache.timestamp < STATS_CACHE_TTL) && (this.statsCache.range === cacheRange)) {
            return this.statsCache.data;
        }

        try {
            let cutoff = 0;
            if (options.timeRange) {
                if (options.timeRange === '15m') cutoff = now - 15 * 60 * 1000;
                else if (options.timeRange === '1h') cutoff = now - 3600000;
                else if (options.timeRange === '6h') cutoff = now - 6 * 3600000;
                else if (options.timeRange === '24h') cutoff = now - 24 * 3600000;
                else if (options.timeRange === '7d') cutoff = now - 7 * 24 * 3600000;
            }

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

            const httpResults = filtered.filter(r => r.endpointType === 'HTTP' || r.endpointType === 'HTTPS');

            // Group by endpoint to find flaky ones
            const endpointStats = new Map<string, { name: string, count: number, success: number, totalScore: number }>();
            filtered.forEach(r => {
                const stats = endpointStats.get(r.endpointId) || { name: r.endpointName, count: 0, success: 0, totalScore: 0 };
                stats.count++;
                if (r.reachable) stats.success++;
                stats.totalScore += r.score;
                endpointStats.set(r.endpointId, stats);
            });

            const flakyEndpoints = Array.from(endpointStats.entries())
                .filter(([id, _]) => !options.activeProbeIds || options.activeProbeIds.includes(id)) // Only consider active probes for flaky list
                .map(([id, stats]) => ({
                    id,
                    name: stats.name,
                    reliability: Math.round((stats.success / stats.count) * 100),
                    avgScore: Math.round(stats.totalScore / stats.count)
                }))
                .filter(e => e.reliability < 95 || e.avgScore < 70) // Definition of flaky
                .sort((a, b) => (a.reliability + a.avgScore) - (b.reliability + b.avgScore))
                .slice(0, 3);

            // Filter httpResults to only include active probes to calculate accurate global health
            const activeHttpResults = options.activeProbeIds
                ? httpResults.filter(r => options.activeProbeIds!.includes(r.endpointId))
                : httpResults;

            const uniqueHttpEndpoints = new Set(activeHttpResults.map(r => r.endpointId)).size;

            const computedStats = {
                globalHealth: activeHttpResults.length > 0 ? Math.round(activeHttpResults.reduce((acc, r) => acc + (r.score || 0), 0) / activeHttpResults.length) : 0,
                httpEndpoints: {
                    total: uniqueHttpEndpoints,
                    avgScore: activeHttpResults.length > 0 ? Math.round(activeHttpResults.reduce((acc, r) => acc + (r.score || 0), 0) / activeHttpResults.length) : 0,
                    minScore: activeHttpResults.length > 0 ? activeHttpResults.reduce((min, r) => Math.min(min, r.score || 0), activeHttpResults[0].score || 0) : 0,
                    maxScore: activeHttpResults.length > 0 ? activeHttpResults.reduce((max, r) => Math.max(max, r.score || 0), activeHttpResults[0].score || 0) : 0
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
                
                // Read file line by line using a buffer to stay memory efficient
                // while being able to stop early easily.
                const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
                const rl = readline.createInterface({
                    input: fileStream,
                    terminal: false
                });

                const fileLines: ConnectivityResult[] = [];
                for await (const line of rl) {
                    if (!line.trim()) continue;
                    try {
                        const result = JSON.parse(line) as ConnectivityResult;
                        
                        // Skip if too old
                        if (minTimestamp && result.timestamp < minTimestamp) {
                            continue;
                        }

                        fileLines.push(result);
                        
                        // If we have a maxResults limit and it's a single file we are reading, 
                        // we can't easily stop early because files are oldest-to-newest.
                        // But we can limit the local buffer.
                        if (maxResults && fileLines.length > maxResults) {
                            fileLines.shift(); // Keep newest N lines
                        }
                    } catch (e) { }
                }

                // Since we read oldest to newest, reverse to get newest first
                for (const res of fileLines.reverse()) {
                    allResults.push(res);
                    if (maxResults && allResults.length >= maxResults) {
                        fileStream.destroy();
                        return allResults;
                    }
                }

                // Optimization: if the earliest result in this file is already before our cutoff,
                // we don't need to look at older files.
                if (minTimestamp && fileLines.length > 0) {
                    // fileLines[0] is now the OLDEST after the reverse loop? 
                    // No, fileLines was reversed into allResults.
                    // The original fileLines[0] was the oldest line from the file.
                    // But we used .reverse() in the loop.
                    // Let's just check the last one we added to fileLines before reverse.
                }
                
                fileStream.destroy();
            }
            return allResults;
        } catch (error) {
            log('CONNECTIVITY_LOGGER', `Read failed: ${error}`, 'error');
            return [];
        }
    }
}
