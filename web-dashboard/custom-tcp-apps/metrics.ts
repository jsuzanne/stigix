/**
 * Stigix Custom TCP Inter-Site Applications — Metrics & Percentile Tracker
 */

import { RttStats, AppRuntimeMetrics, ListenerState, AppHealthState } from './types.js';

export class RollingRttTracker {
    private samples: number[] = [];
    private readonly maxSamples: number;

    constructor(maxSamples: number = 100) {
        this.maxSamples = maxSamples;
    }

    public record(rttMs: number): void {
        if (typeof rttMs !== 'number' || isNaN(rttMs) || rttMs < 0) return;
        this.samples.push(rttMs);
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }
    }

    public getStats(): RttStats {
        if (this.samples.length === 0) {
            return { last: 0, min: 0, avg: 0, p50: 0, p95: 0, max: 0, samples: 0 };
        }

        const sorted = [...this.samples].sort((a, b) => a - b);
        const count = sorted.length;
        const sum = sorted.reduce((acc, val) => acc + val, 0);
        const min = sorted[0];
        const max = sorted[count - 1];
        const avg = Number((sum / count).toFixed(2));
        const last = this.samples[this.samples.length - 1];

        // Percentiles
        const p50Idx = Math.min(Math.floor(count * 0.5), count - 1);
        const p95Idx = Math.min(Math.floor(count * 0.95), count - 1);
        const p50 = Number(sorted[p50Idx].toFixed(2));
        const p95 = Number(sorted[p95Idx].toFixed(2));

        return { last: Number(last.toFixed(2)), min, avg, p50, p95, max, samples: count };
    }

    public reset(): void {
        this.samples = [];
    }
}

export class AppMetricsTracker {
    public readonly appId: string;
    public appName: string;
    public port: number;
    public listenerState: ListenerState = 'stopped';
    public listenerError?: string;
    public clientWorkloadRunning: boolean = false;

    public totalTxBytes: number = 0;
    public totalRxBytes: number = 0;
    public totalRequests: number = 0;
    public totalResponses: number = 0;
    public totalTimeouts: number = 0;
    public totalErrors: number = 0;
    public totalReconnects: number = 0;
    public totalSimulatedDrops: number = 0;

    private readonly globalRttTracker = new RollingRttTracker(200);

    constructor(appId: string, appName: string, port: number) {
        this.appId = appId;
        this.appName = appName;
        this.port = port;
    }

    public recordRtt(rttMs: number): void {
        this.globalRttTracker.record(rttMs);
    }

    public recordTx(bytes: number): void {
        this.totalTxBytes += bytes;
    }

    public recordRx(bytes: number): void {
        this.totalRxBytes += bytes;
    }

    public getSnapshot(activeIncoming: number, activeOutgoing: number): AppRuntimeMetrics {
        const rttStats = this.globalRttTracker.getStats();

        // Calculate health state
        let health: AppHealthState = 'healthy';
        if (this.listenerState === 'bind_error' || this.listenerState === 'port_conflict') {
            health = 'listener_error';
        } else if (this.listenerState === 'stopped' && !this.clientWorkloadRunning) {
            health = 'stopped';
        } else if (this.totalTimeouts > 5 || this.totalErrors > 5 || rttStats.p95 > 2000) {
            health = 'degraded';
        } else if (this.clientWorkloadRunning && activeOutgoing === 0 && this.totalTimeouts > 0) {
            health = 'unreachable';
        }

        return {
            appId: this.appId,
            appName: this.appName,
            port: this.port,
            listenerState: this.listenerState,
            listenerError: this.listenerError,
            clientWorkloadRunning: this.clientWorkloadRunning,
            activeIncomingSessions: activeIncoming,
            activeOutgoingSessions: activeOutgoing,
            totalTxBytes: this.totalTxBytes,
            totalRxBytes: this.totalRxBytes,
            totalRequests: this.totalRequests,
            totalResponses: this.totalResponses,
            totalTimeouts: this.totalTimeouts,
            totalErrors: this.totalErrors,
            totalReconnects: this.totalReconnects,
            totalSimulatedDrops: this.totalSimulatedDrops,
            avgRttMs: rttStats.avg,
            p95RttMs: rttStats.p95,
            health
        };
    }
}
