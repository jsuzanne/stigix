import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { promisify } from 'util';
import { log } from './utils/logger.js';

const writeFile = promisify(fs.writeFile);
const appendFile = promisify(fs.appendFile);
const readFile = promisify(fs.readFile);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

export interface TestResult {
    id: number;
    timestamp: number;
    type: 'url' | 'dns' | 'threat';
    name: string;
    status: 'allowed' | 'blocked' | 'sinkholed' | 'unreachable' | 'error';
    details?: {
        url?: string;
        domain?: string;
        endpoint?: string;
        command?: string;
        output?: string;
        error?: string;
        executionTime?: number;
        resolvedIp?: string;
    };
    slsDiagnostic?: any;
    runId?: string;
    previousStatus?: 'allowed' | 'blocked' | 'sinkholed' | 'unreachable' | 'error' | null;
}

export interface LogStats {
    totalTests: number;
    testsByType: { url: number; dns: number; threat: number };
    testsByStatus: { blocked: number; allowed: number; sinkholed: number; error: number };
    diskUsageBytes: number;
    oldestTest: number | null;
    newestTest: number | null;
}

export class TestLogger {
    private logDir: string;
    private retentionDays: number;
    private maxLogSizeMB: number;
    private currentLogFile: string;

    constructor(logDir: string, retentionDays: number = 7, maxLogSizeMB: number = 100) {
        this.logDir = logDir;
        this.retentionDays = retentionDays;
        this.maxLogSizeMB = maxLogSizeMB;
        this.currentLogFile = path.join(logDir, 'test-results.jsonl');

        // Ensure log directory exists
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
    }

    /**
     * Log a test result to JSONL file
     */
    async logTest(result: TestResult): Promise<void> {
        try {
            // Check if log rotation is needed
            await this.rotateIfNeeded();

            // Append to current log file
            const line = JSON.stringify(result) + '\n';
            await appendFile(this.currentLogFile, line, 'utf8');
        } catch (error) {
            log('TEST_LOGGER', `Failed to log test: ${error}`, 'error');
        }
    }

    /**
     * Rotate log file if it exceeds max size
     */
    private async rotateIfNeeded(): Promise<void> {
        try {
            if (!fs.existsSync(this.currentLogFile)) {
                return;
            }

            const stats = await stat(this.currentLogFile);
            const sizeMB = stats.size / (1024 * 1024);

            if (sizeMB >= this.maxLogSizeMB) {
                // Rotate: rename current file with timestamp
                const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
                const rotatedFile = path.join(this.logDir, `test-results-${timestamp}.jsonl`);

                // If rotated file already exists, append a number
                let counter = 1;
                let finalRotatedFile = rotatedFile;
                while (fs.existsSync(finalRotatedFile)) {
                    finalRotatedFile = path.join(this.logDir, `test-results-${timestamp}-${counter}.jsonl`);
                    counter++;
                }

                fs.renameSync(this.currentLogFile, finalRotatedFile);
                log('TEST_LOGGER', `Rotated log file to: ${finalRotatedFile}`);
            }
        } catch (error) {
            log('TEST_LOGGER', `Failed to rotate log: ${error}`, 'error');
        }
    }

    /**
     * Clean up old log files based on retention policy
     */
    async cleanup(): Promise<number> {
        try {
            const files = await readdir(this.logDir);
            const logFiles = files.filter(f => f.startsWith('test-results') && f.endsWith('.jsonl'));

            const cutoffDate = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
            let deletedCount = 0;

            for (const file of logFiles) {
                const filePath = path.join(this.logDir, file);
                const stats = await stat(filePath);

                if (stats.mtimeMs < cutoffDate) {
                    await unlink(filePath);
                    deletedCount++;
                    log('TEST_LOGGER', `Deleted old log file: ${file}`);
                }
            }

            return deletedCount;
        } catch (error) {
            log('TEST_LOGGER', `Failed to cleanup logs: ${error}`, 'error');
            return 0;
        }
    }

    /**
     * Get test results with pagination and filtering
     */
    async getResults(options: {
        limit?: number;
        offset?: number;
        search?: string;
        type?: 'url' | 'dns' | 'threat';
        status?: 'blocked' | 'allowed' | 'sinkholed' | 'error';
        runId?: string;
    } = {}): Promise<{ results: TestResult[]; total: number }> {
        try {
            const allResults = await this.readAllResults();

            // Apply filters
            let filtered = allResults;

            if (options.search) {
                const searchLower = options.search.toLowerCase();
                filtered = filtered.filter(r =>
                    r.id.toString().includes(searchLower) ||
                    r.name.toLowerCase().includes(searchLower) ||
                    r.status.toLowerCase().includes(searchLower)
                );
            }

            if (options.runId) {
                filtered = filtered.filter(r => r.runId === options.runId);
            }

            if (options.type) {
                filtered = filtered.filter(r => r.type === options.type);
            }

            if (options.status) {
                filtered = filtered.filter(r => r.status === options.status);
            }

            // Sort by timestamp descending (newest first)
            filtered.sort((a, b) => b.timestamp - a.timestamp);

            // Build previousStatus: for each result, find the last prior result with same name+type
            // We need the full chronological list to look backwards
            const chronological = [...allResults].sort((a, b) => a.timestamp - b.timestamp);
            const lastSeenStatus = new Map<string, 'allowed' | 'blocked' | 'sinkholed' | 'unreachable' | 'error'>();
            const previousStatusMap = new Map<number, typeof lastSeenStatus extends Map<any, infer V> ? V : never>();
            for (const r of chronological) {
                const key = `${r.type}::${r.name}`;
                const prev = lastSeenStatus.get(key);
                if (prev !== undefined) {
                    previousStatusMap.set(r.id, prev);
                }
                lastSeenStatus.set(key, r.status);
            }

            // Annotate filtered results with previousStatus
            const annotated = filtered.map(r => ({
                ...r,
                previousStatus: previousStatusMap.has(r.id) ? previousStatusMap.get(r.id) : null
            }));

            // Apply pagination
            const offset = options.offset || 0;
            const limit = options.limit || 50;
            const paginated = annotated.slice(offset, offset + limit);

            return {
                results: paginated,
                total: filtered.length
            };
        } catch (error) {
            log('TEST_LOGGER', `Failed to get results: ${error}`, 'error');
            return { results: [], total: 0 };
        }
    }

    /**
     * Get the latest status for a specific test (by type and name)
     */
    async getLatestStatus(type: string, name: string): Promise<TestResult['status'] | null> {
        try {
            const allResults = await this.readAllResults();
            const latest = allResults.find(r => r.type === type && r.name === name);
            return latest ? latest.status : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get a single test result by ID
     */
    async getResultById(id: number): Promise<TestResult | null> {
        try {
            const allResults = await this.readAllResults();
            return allResults.find(r => r.id === id) || null;
        } catch (error) {
            log('TEST_LOGGER', `Failed to get result by ID: ${error}`, 'error');
            return null;
        }
    }

    /**
     * Get log statistics
     */
    async getStats(): Promise<LogStats> {
        try {
            const allResults = await this.readAllResults();

            const stats: LogStats = {
                totalTests: allResults.length,
                testsByType: { url: 0, dns: 0, threat: 0 },
                testsByStatus: { blocked: 0, allowed: 0, sinkholed: 0, error: 0 },
                diskUsageBytes: 0,
                oldestTest: null,
                newestTest: null
            };

            // Count by type and status
            allResults.forEach(r => {
                stats.testsByType[r.type]++;
                stats.testsByStatus[r.status]++;
            });

            // Get oldest and newest
            if (allResults.length > 0) {
                const sorted = [...allResults].sort((a, b) => a.timestamp - b.timestamp);
                stats.oldestTest = sorted[0].timestamp;
                stats.newestTest = sorted[sorted.length - 1].timestamp;
            }

            // Calculate disk usage
            const files = await readdir(this.logDir);
            const logFiles = files.filter(f => f.startsWith('test-results') && f.endsWith('.jsonl'));

            for (const file of logFiles) {
                const filePath = path.join(this.logDir, file);
                const fileStats = await stat(filePath);
                stats.diskUsageBytes += fileStats.size;
            }

            return stats;
        } catch (error) {
            log('TEST_LOGGER', `Failed to get stats: ${error}`, 'error');
            return {
                totalTests: 0,
                testsByType: { url: 0, dns: 0, threat: 0 },
                testsByStatus: { blocked: 0, allowed: 0, sinkholed: 0, error: 0 },
                diskUsageBytes: 0,
                oldestTest: null,
                newestTest: null
            };
        }
    }

    /**
     * Delete all test results (manual cleanup)
     */
    async deleteAll(): Promise<number> {
        try {
            const files = await readdir(this.logDir);
            const logFiles = files.filter(f => f.startsWith('test-results') && f.endsWith('.jsonl'));

            for (const file of logFiles) {
                const filePath = path.join(this.logDir, file);
                await unlink(filePath);
            }

            return logFiles.length;
        } catch (error) {
            log('TEST_LOGGER', `Failed to delete all logs: ${error}`, 'error');
            return 0;
        }
    }

    /**
     * Read all test results from all log files
     */
    private async readAllResults(): Promise<TestResult[]> {
        try {
            const files = await readdir(this.logDir);
            const logFiles = files
                .filter(f => f.startsWith('test-results') && f.endsWith('.jsonl'))
                .sort()
                .reverse(); // Newest first

            const allResults: TestResult[] = [];

            for (const file of logFiles) {
                const filePath = path.join(this.logDir, file);
                
                const fileStream = fs.createReadStream(filePath);
                const rl = readline.createInterface({
                    input: fileStream,
                    terminal: false
                });

                const fileLines: TestResult[] = [];
                for await (const line of rl) {
                    if (!line.trim()) continue;
                    try {
                        const result = JSON.parse(line);
                        fileLines.push(result);
                    } catch (e) { }
                }

                fileLines.reverse();
                for (const res of fileLines) {
                    allResults.push(res);
                }
            }

            return allResults;
        } catch (error) {
            log('TEST_LOGGER', `Failed to read all results: ${error}`, 'error');
            return [];
        }
    }
}
