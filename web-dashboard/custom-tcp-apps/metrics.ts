/**
 * Stigix Custom TCP Inter-Site Applications — Metrics & Percentile Tracker
 */

import { RttStats, AppRuntimeMetrics, ListenerState, AppHealthState } from './types.js';

export class RollingRttTracker {
    private samples: number[] = [];
    private serverDelays: number[] = [];
    private networkRtts: number[] = [];
    private prevRttMs?: number;
    private jitterSamples: number[] = [];
    private readonly maxSamples: number;

    constructor(maxSamples: number = 100) {
        this.maxSamples = maxSamples;
    }

    public record(rttMs: number, serverDelayMs: number = 0, networkRttMs?: number): void {
        if (typeof rttMs !== 'number' || isNaN(rttMs) || rttMs < 0) return;
        this.samples.push(rttMs);
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }

        const netRtt = networkRttMs !== undefined ? networkRttMs : Math.max(0, rttMs - serverDelayMs);
        this.serverDelays.push(serverDelayMs);
        this.networkRtts.push(netRtt);
        if (this.serverDelays.length > this.maxSamples) this.serverDelays.shift();
        if (this.networkRtts.length > this.maxSamples) this.networkRtts.shift();

        if (this.prevRttMs !== undefined) {
            const delta = Math.abs(rttMs - this.prevRttMs);
            this.jitterSamples.push(delta);
            if (this.jitterSamples.length > this.maxSamples) {
                this.jitterSamples.shift();
            }
        }
        this.prevRttMs = rttMs;
    }

    public getStats(): RttStats {
        if (this.samples.length === 0) {
            return {
                last: 0, min: 0, avg: 0, p50: 0, p95: 0, max: 0, samples: 0,
                jitterMs: 0, recentSamples: [], serverDelayMs: 0, networkRttMs: 0,
                avgServerDelayMs: 0, avgNetworkRttMs: 0
            };
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

        // Jitter (mean absolute consecutive RTT difference)
        let jitterMs = 0;
        if (this.jitterSamples.length > 0) {
            const jSum = this.jitterSamples.reduce((acc, val) => acc + val, 0);
            jitterMs = Number((jSum / this.jitterSamples.length).toFixed(2));
        }

        // Recent samples (last 20 points for sparkline)
        const recentSamples = this.samples.slice(-20);

        // Server Delay vs Network RTT averages
        const lastServerDelay = this.serverDelays.length > 0 ? this.serverDelays[this.serverDelays.length - 1] : 0;
        const lastNetworkRtt = this.networkRtts.length > 0 ? this.networkRtts[this.networkRtts.length - 1] : last;

        const avgServerDelay = this.serverDelays.length > 0
            ? Number((this.serverDelays.reduce((a, b) => a + b, 0) / this.serverDelays.length).toFixed(2))
            : 0;
        const avgNetworkRtt = this.networkRtts.length > 0
            ? Number((this.networkRtts.reduce((a, b) => a + b, 0) / this.networkRtts.length).toFixed(2))
            : avg;

        return {
            last: Number(last.toFixed(2)),
            min,
            avg,
            p50,
            p95,
            max,
            samples: count,
            jitterMs,
            recentSamples,
            serverDelayMs: lastServerDelay,
            networkRttMs: lastNetworkRtt,
            avgServerDelayMs: avgServerDelay,
            avgNetworkRttMs: avgNetworkRtt
        };
    }

    public reset(): void {
        this.samples = [];
        this.serverDelays = [];
        this.networkRtts = [];
        this.jitterSamples = [];
        this.prevRttMs = undefined;
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
    public serverTxBytes: number = 0;
    public serverRxBytes: number = 0;
    public clientTxBytes: number = 0;
    public clientRxBytes: number = 0;
    public totalRequests: number = 0;
    public totalResponses: number = 0;
    public totalTimeouts: number = 0;
    public totalErrors: number = 0;
    public totalReconnects: number = 0;
    public totalSimulatedDrops: number = 0;

    // Rate calculations
    private lastRateCalcTs: number = Date.now();
    private prevTxBytes: number = 0;
    private prevRxBytes: number = 0;
    private prevRequests: number = 0;
    private liveTxBps: number = 0;
    private liveRxBps: number = 0;
    private liveTps: number = 0;

    private readonly globalRttTracker = new RollingRttTracker(200);

    constructor(appId: string, appName: string, port: number) {
        this.appId = appId;
        this.appName = appName;
        this.port = port;
    }

    public reset(): void {
        this.totalTxBytes = 0;
        this.totalRxBytes = 0;
        this.serverTxBytes = 0;
        this.serverRxBytes = 0;
        this.clientTxBytes = 0;
        this.clientRxBytes = 0;
        this.totalRequests = 0;
        this.totalResponses = 0;
        this.totalTimeouts = 0;
        this.totalErrors = 0;
        this.totalReconnects = 0;
        this.totalSimulatedDrops = 0;
        this.prevTxBytes = 0;
        this.prevRxBytes = 0;
        this.prevRequests = 0;
        this.liveTxBps = 0;
        this.liveRxBps = 0;
        this.liveTps = 0;
        this.lastRateCalcTs = Date.now();
        this.globalRttTracker.reset();
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

    public recordServerTx(bytes: number): void {
        this.serverTxBytes += bytes;
        this.totalTxBytes += bytes;
    }

    public recordServerRx(bytes: number): void {
        this.serverRxBytes += bytes;
        this.totalRxBytes += bytes;
    }

    public recordClientTx(bytes: number): void {
        this.clientTxBytes += bytes;
        this.totalTxBytes += bytes;
    }

    public recordClientRx(bytes: number): void {
        this.clientRxBytes += bytes;
        this.totalRxBytes += bytes;
    }

    public getSnapshot(activeIncoming: number, activeOutgoing: number): AppRuntimeMetrics {
        const rttStats = this.globalRttTracker.getStats();

        // Calculate live throughput rates (bps and TPS)
        const now = Date.now();
        const deltaSec = (now - this.lastRateCalcTs) / 1000;
        if (deltaSec >= 0.8) {
            this.liveTxBps = Math.max(0, Math.round(((this.totalTxBytes - this.prevTxBytes) * 8) / deltaSec));
            this.liveRxBps = Math.max(0, Math.round(((this.totalRxBytes - this.prevRxBytes) * 8) / deltaSec));
            this.liveTps = Number((Math.max(0, (this.totalRequests - this.prevRequests)) / deltaSec).toFixed(1));
            this.prevTxBytes = this.totalTxBytes;
            this.prevRxBytes = this.totalRxBytes;
            this.prevRequests = this.totalRequests;
            this.lastRateCalcTs = now;
        }

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
            serverTxBytes: this.serverTxBytes,
            serverRxBytes: this.serverRxBytes,
            clientTxBytes: this.clientTxBytes,
            clientRxBytes: this.clientRxBytes,
            totalRequests: this.totalRequests,
            totalResponses: this.totalResponses,
            totalTimeouts: this.totalTimeouts,
            totalErrors: this.totalErrors,
            totalReconnects: this.totalReconnects,
            totalSimulatedDrops: this.totalSimulatedDrops,
            avgRttMs: rttStats.avg,
            p50RttMs: rttStats.p50,
            p95RttMs: rttStats.p95,
            jitterMs: rttStats.jitterMs,
            liveTxBps: this.liveTxBps,
            liveRxBps: this.liveRxBps,
            liveTps: this.liveTps,
            health
        };
    }
}
