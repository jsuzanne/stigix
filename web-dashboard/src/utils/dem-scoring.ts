/**
 * Stigix Digital Experience Monitoring (DEM) Scoring Engine & Explainer
 * Accurately replicates backend calculateDEMScore and produces transparent,
 * human-readable step-by-step mathematical breakdowns for all probe types.
 */

export interface ScoreFactor {
    name: string;
    category: 'status_code' | 'latency' | 'ttfb' | 'tls' | 'loss' | 'jitter' | 'content' | 'connectivity';
    value: string;
    impact: number; // e.g. -80, -2.5, 0
    status: 'optimal' | 'warning' | 'penalty' | 'neutral';
    detail: string;
    formula?: string;
    isCritical?: boolean;
}

export interface DEMScoreExplanation {
    baseScore: number;
    finalScore: number;
    probeType: string;
    isReachable: boolean;
    verdict: 'optimal' | 'good' | 'degraded' | 'critical' | 'down';
    primaryReason: string;
    summary: string;
    factors: ScoreFactor[];
    recommendations: string[];
    allowedStatusCodes: number[];
    receivedStatusCode?: number;
    canAddStatusCode: boolean;
    missingStatusCode?: number;
}

export const DEFAULT_HTTP_EXPECTED_STATUS_CODES = [200, 201, 202, 204, 301, 302, 304, 307, 308];

/**
 * Explains and breaks down the exact DEM score calculation for any probe capture.
 */
export function explainDEMScore(probe: any, result?: any): DEMScoreExplanation {
    const type = (probe?.type || result?.endpointType || 'HTTP').toUpperCase();
    const metrics = result?.metrics || {};
    const lat = Number(metrics.total_ms || result?.latency || 0);
    const reachable = result ? (result.reachable !== false && result.status !== 'failed') : true;
    const httpCode = result?.httpCode !== undefined ? Number(result.httpCode) : undefined;
    
    // Resolve expected status codes
    let allowedStatusCodes: number[] = DEFAULT_HTTP_EXPECTED_STATUS_CODES;
    const probeCodes = probe?.expectedStatusCodes || probe?.expected_status_codes;
    if (Array.isArray(probeCodes) && probeCodes.length > 0) {
        allowedStatusCodes = probeCodes.map(Number);
    } else if (typeof probeCodes === 'string' && probeCodes.trim()) {
        allowedStatusCodes = probeCodes.split(',').map((s: string) => parseInt(s.trim())).filter((n: number) => !isNaN(n));
    }

    const recordedScore = result?.score !== undefined ? Number(result.score) : undefined;
    const factors: ScoreFactor[] = [];
    const recommendations: string[] = [];
    let baseScore = 100;
    let computedScore = 100;
    let verdict: 'optimal' | 'good' | 'degraded' | 'critical' | 'down' = 'optimal';
    let primaryReason = 'Fully operational probe with optimal performance metrics.';
    let canAddStatusCode = false;
    let missingStatusCode: number | undefined = undefined;

    // ─────────────────────────────────────────────────────────────────────────────
    // 1. HTTP / HTTPS Probes
    // ─────────────────────────────────────────────────────────────────────────────
    if (type === 'HTTP' || type === 'HTTPS') {
        const ttfb = Number(metrics.ttfb_ms || 0);
        const tls = Number(metrics.tls_ms || 0);
        const dns = Number(metrics.dns_ms || 0);
        const tcp = Number(metrics.tcp_ms || 0);

        // Content Match inspection
        const cm = probe?.content_match;
        const cmEnabled = Boolean(cm?.enabled);
        const cmOk = result?.content_match_ok;
        const cmRes = result?.content_match_result;

        // Check unreachability / outage
        if (!reachable || !httpCode || httpCode <= 0) {
            computedScore = 0;
            verdict = 'down';
            primaryReason = 'Network connection failure (unreachable host, DNS resolution error, or rejected socket).';
            factors.push({
                name: 'Connectivity',
                category: 'connectivity',
                value: 'Unreachable',
                impact: -100,
                status: 'penalty',
                detail: 'No HTTP packet received. Connection aborted before application response.',
                isCritical: true
            });
            recommendations.push('Verify target URL, DNS resolution, and Stigix node WAN egress.');
        } else if (lat >= 5000) {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `Request timeout exceeded (${lat.toFixed(0)} ms ≥ 5,000 ms).`;
            factors.push({
                name: 'Request Timeout',
                category: 'latency',
                value: `${lat.toFixed(0)} ms`,
                impact: -100,
                status: 'penalty',
                detail: 'Response time exceeded the 5-second SLA cut-off threshold.',
                isCritical: true
            });
            recommendations.push('Increase probe timeout if the API is inherently slow, or investigate network bottlenecks.');
        } else if (cmEnabled && cmOk === false) {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `HTTP body validation failed (Content Match: ${cmRes || 'pattern missing'}).`;
            factors.push({
                name: 'Content Match',
                category: 'content',
                value: `Expected: "${cm.value}"`,
                impact: -100,
                status: 'penalty',
                detail: `Content validation (${cm.mode || 'contains'}) failed. Received: ${cmRes || 'non-compliant'}.`,
                isCritical: true
            });
            recommendations.push(`Adjust expected pattern ("${cm.value}") or verify returned HTTP response payload.`);
        } else {
            // Status code validation
            const isExpected = allowedStatusCodes.includes(httpCode);

            if (!isExpected) {
                missingStatusCode = httpCode;
                canAddStatusCode = true;

                if (httpCode >= 500) {
                    computedScore = 0;
                    verdict = 'critical';
                    primaryReason = `Target server internal error (HTTP ${httpCode}).`;
                    factors.push({
                        name: 'HTTP Status Code (5xx)',
                        category: 'status_code',
                        value: `HTTP ${httpCode}`,
                        impact: -100,
                        status: 'penalty',
                        detail: `Critical application server error. Expected status codes: [${allowedStatusCodes.join(', ')}].`,
                        isCritical: true
                    });
                    recommendations.push(`Remote server returned a 5xx error. Inspect backend logs for service ${probe?.target || ''}.`);
                } else if (httpCode >= 400) {
                    computedScore = 20;
                    verdict = 'degraded';
                    primaryReason = httpCode === 429
                        ? `Rate limiting detected (HTTP 429 Too Many Requests). Score capped at 20.`
                        : `Unexpected client error status code (HTTP ${httpCode}). Score capped at 20.`;

                    factors.push({
                        name: `HTTP Status Code ${httpCode}`,
                        category: 'status_code',
                        value: `HTTP ${httpCode}`,
                        impact: -80,
                        status: 'penalty',
                        detail: httpCode === 429
                            ? `Target service is rate-limiting requests (HTTP 429). Stigix caps score at 20 for safety.`
                            : `Status code is not in allowed list [${allowedStatusCodes.join(', ')}]. Score capped at 20.`,
                        isCritical: true
                    });

                    if (httpCode === 429) {
                        recommendations.push('If HTTP 429 is expected for this test, allow status code 429 in probe settings.');
                        recommendations.push('Otherwise, increase probing interval to avoid triggering rate limiters.');
                    } else {
                        recommendations.push(`If HTTP ${httpCode} is a valid response for this endpoint, add it to the allowed status codes.`);
                    }
                } else {
                    computedScore = 20;
                    verdict = 'degraded';
                    primaryReason = `Unexpected redirect or status code (HTTP ${httpCode}). Score capped at 20.`;
                    factors.push({
                        name: 'HTTP Status Code',
                        category: 'status_code',
                        value: `HTTP ${httpCode}`,
                        impact: -80,
                        status: 'penalty',
                        detail: `Unexpected status code received. Expected codes: [${allowedStatusCodes.join(', ')}].`,
                        isCritical: true
                    });
                    recommendations.push(`Add ${httpCode} to probe configuration if this response is normal.`);
                }
            } else {
                // Expected HTTP Code: full math breakdown
                factors.push({
                    name: 'HTTP Status Code',
                    category: 'status_code',
                    value: `HTTP ${httpCode}`,
                    impact: 0,
                    status: 'optimal',
                    detail: `Status code conforms to expected list [${allowedStatusCodes.join(', ')}].`
                });

                if (ttfb <= 0 && lat > 0) {
                    computedScore = 0;
                    verdict = 'critical';
                    primaryReason = 'Connection terminated before first byte received (TTFB = 0).';
                    factors.push({
                        name: 'Interrupted TTFB',
                        category: 'ttfb',
                        value: '0 ms',
                        impact: -100,
                        status: 'penalty',
                        detail: 'Server closed socket prematurely before responding.',
                        isCritical: true
                    });
                } else {
                    const total_norm = Math.min(lat / 2000, 1.0);
                    const ttfb_norm = Math.min(ttfb / 1000, 1.0);
                    const tls_norm = Math.min(tls / 800, 1.0);

                    const totalDed = Math.round(30 * total_norm * 10) / 10;
                    const ttfbDed = Math.round(35 * ttfb_norm * 10) / 10;
                    const tlsDed = Math.round(25 * tls_norm * 10) / 10;

                    // Latency factor (max -30)
                    factors.push({
                        name: 'Total Latency',
                        category: 'latency',
                        value: `${lat.toFixed(1)} ms`,
                        impact: -totalDed,
                        status: totalDed <= 5 ? 'optimal' : totalDed <= 15 ? 'warning' : 'penalty',
                        detail: `Max weight: -30 pts. Normalized on 2,000 ms (${Math.round(total_norm * 100)}% of ceiling).`,
                        formula: `- (30 × min(${lat.toFixed(1)} / 2000, 1.0)) = -${totalDed} pts`
                    });

                    // TTFB factor (max -35)
                    factors.push({
                        name: 'TTFB (Backend)',
                        category: 'ttfb',
                        value: `${ttfb.toFixed(1)} ms`,
                        impact: -ttfbDed,
                        status: ttfbDed <= 6 ? 'optimal' : ttfbDed <= 18 ? 'warning' : 'penalty',
                        detail: `Max weight: -35 pts. Normalized on 1,000 ms. Reflects backend application responsiveness.`,
                        formula: `- (35 × min(${ttfb.toFixed(1)} / 1000, 1.0)) = -${ttfbDed} pts`
                    });

                    // TLS factor (max -25)
                    if (type === 'HTTPS' || tls > 0) {
                        factors.push({
                            name: 'TLS Handshake',
                            category: 'tls',
                            value: `${tls.toFixed(1)} ms`,
                            impact: -tlsDed,
                            status: tlsDed <= 4 ? 'optimal' : tlsDed <= 12 ? 'warning' : 'penalty',
                            detail: `Max weight: -25 pts. Normalized on 800 ms. Elevated TLS indicates SASE inspection or distant hops.`,
                            formula: `- (25 × min(${tls.toFixed(1)} / 800, 1.0)) = -${tlsDed} pts`
                        });
                    }

                    computedScore = Math.max(0, Math.min(100, Math.round(100 - (totalDed + ttfbDed + tlsDed))));

                    if (computedScore >= 90) {
                        verdict = 'optimal';
                        primaryReason = 'Excellent application and network responsiveness (score > 90).';
                    } else if (computedScore >= 75) {
                        verdict = 'good';
                        primaryReason = 'Satisfactory overall performance with slight observed slowdown.';
                    } else if (computedScore >= 50) {
                        verdict = 'degraded';
                        primaryReason = 'Degraded latency or backend processing time.';
                        if (ttfbDed > 15) recommendations.push('High TTFB: optimize target server response time.');
                        if (tlsDed > 10) recommendations.push('Slow TLS handshake: verify certificate negotiation or intermediate proxy/SASE inspection.');
                    } else {
                        verdict = 'critical';
                        primaryReason = 'Excessive latency near SLA threshold limits.';
                        recommendations.push('Inspect hosting infrastructure and WAN network bottlenecks.');
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. PING (ICMP) Probes
    // ─────────────────────────────────────────────────────────────────────────────
    else if (type === 'PING') {
        if (!reachable || lat <= 0) {
            computedScore = 0;
            verdict = 'down';
            primaryReason = 'Total packet loss (100% loss). Host unreachable via ICMP.';
            factors.push({
                name: 'ICMP Echo',
                category: 'loss',
                value: '100% Loss',
                impact: -100,
                status: 'penalty',
                detail: 'No ICMP echo response received before timeout expiration.',
                isCritical: true
            });
            recommendations.push('Check if remote host or intermediate firewall blocks ICMP echo requests.');
        } else if (lat < 100) {
            computedScore = 100;
            verdict = 'optimal';
            primaryReason = `Excellent ICMP latency (${lat.toFixed(1)} ms < 100 ms). No penalty applied.`;
            factors.push({
                name: 'ICMP Latency',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: 0,
                status: 'optimal',
                detail: 'Optimal SLA threshold: under 100 ms, zero penalty points deducted.',
                formula: 'lat < 100 ms ➔ Score 100/100'
            });
        } else if (lat <= 500) {
            const ded = Math.round(((lat - 100) / 400) * 100 * 10) / 10;
            computedScore = Math.max(0, Math.min(100, Math.round(100 - ded)));
            verdict = computedScore >= 70 ? 'good' : 'degraded';
            primaryReason = `Moderate latency (${lat.toFixed(1)} ms). Graduated penalty applied.`;
            factors.push({
                name: 'ICMP Latency',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -ded,
                status: ded <= 25 ? 'warning' : 'penalty',
                detail: `Linear penalty applied between 100 ms and 500 ms across a 400 ms range.`,
                formula: `100 - ((${lat.toFixed(1)} - 100) / 400) × 100 = ${computedScore}/100`
            });
            if (computedScore < 70) recommendations.push('Inspect WAN routing or jitter on this path.');
        } else {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `Excessive latency (${lat.toFixed(1)} ms > 500 ms). Exceeded Ping SLA.`;
            factors.push({
                name: 'ICMP Latency',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -100,
                status: 'penalty',
                detail: 'Any ping exceeding 500 ms incurs a zero score penalty.',
                isCritical: true
            });
            recommendations.push('Network latency exceeds acceptable thresholds for SD-WAN links.');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. TCP Connect Probes
    // ─────────────────────────────────────────────────────────────────────────────
    else if (type === 'TCP') {
        if (!reachable) {
            computedScore = 0;
            verdict = 'down';
            primaryReason = 'TCP port closed, filtered, or connection refused.';
            factors.push({
                name: 'TCP Handshake',
                category: 'connectivity',
                value: 'Failed',
                impact: -100,
                status: 'penalty',
                detail: 'TCP SYN/ACK timed out without successful handshake.',
                isCritical: true
            });
            recommendations.push('Verify target service is listening on specified port and check security ACLs.');
        } else if (lat < 150) {
            computedScore = 100;
            verdict = 'optimal';
            primaryReason = `Ultra-fast TCP handshake (${lat.toFixed(1)} ms < 150 ms).`;
            factors.push({
                name: 'TCP Connect',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: 0,
                status: 'optimal',
                detail: 'TCP SLA threshold: under 150 ms, perfect 100/100 score.',
                formula: 'lat < 150 ms ➔ Score 100/100'
            });
        } else if (lat <= 800) {
            const ded = Math.round(((lat - 150) / 650) * 100 * 10) / 10;
            computedScore = Math.max(0, Math.min(100, Math.round(100 - ded)));
            verdict = computedScore >= 70 ? 'good' : 'degraded';
            primaryReason = `Slow TCP connection (${lat.toFixed(1)} ms).`;
            factors.push({
                name: 'TCP Connect',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -ded,
                status: ded <= 25 ? 'warning' : 'penalty',
                detail: `Linear penalty applied between 150 ms and 800 ms across a 650 ms range.`,
                formula: `100 - ((${lat.toFixed(1)} - 150) / 650) × 100 = ${computedScore}/100`
            });
        } else {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `Excessive TCP Connect delay (${lat.toFixed(1)} ms > 800 ms).`;
            factors.push({
                name: 'TCP Connect',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -100,
                status: 'penalty',
                detail: 'TCP handshake exceeding 800 ms incurs a zero score.',
                isCritical: true
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. DNS Probes
    // ─────────────────────────────────────────────────────────────────────────────
    else if (type === 'DNS') {
        if (!reachable) {
            computedScore = 0;
            verdict = 'down';
            primaryReason = 'DNS resolution failure (SERVFAIL, timeout, or no answer received).';
            factors.push({
                name: 'DNS Query',
                category: 'connectivity',
                value: 'Failed',
                impact: -100,
                status: 'penalty',
                detail: 'Target DNS resolver returned no records.',
                isCritical: true
            });
            recommendations.push('Verify DNS resolver IP and ensure UDP/TCP port 53 is allowed.');
        } else if (lat < 80) {
            computedScore = 100;
            verdict = 'optimal';
            primaryReason = `Instant DNS resolution (${lat.toFixed(1)} ms < 80 ms).`;
            factors.push({
                name: 'Resolution Time',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: 0,
                status: 'optimal',
                detail: 'DNS SLA threshold: under 80 ms, score 100/100.',
                formula: 'lat < 80 ms ➔ Score 100/100'
            });
        } else if (lat <= 400) {
            const ded = Math.round(((lat - 80) / 320) * 100 * 10) / 10;
            computedScore = Math.max(0, Math.min(100, Math.round(100 - ded)));
            verdict = computedScore >= 70 ? 'good' : 'degraded';
            primaryReason = `Slow DNS resolution (${lat.toFixed(1)} ms).`;
            factors.push({
                name: 'Resolution Time',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -ded,
                status: ded <= 25 ? 'warning' : 'penalty',
                detail: `Linear penalty applied between 80 ms and 400 ms across a 320 ms range.`,
                formula: `100 - ((${lat.toFixed(1)} - 80) / 320) × 100 = ${computedScore}/100`
            });
        } else {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `Excessively slow DNS resolution (${lat.toFixed(1)} ms > 400 ms).`;
            factors.push({
                name: 'Resolution Time',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -100,
                status: 'penalty',
                detail: 'DNS resolution exceeding 400 ms drops score to 0.',
                isCritical: true
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. UDP (iperf3) Probes
    // ─────────────────────────────────────────────────────────────────────────────
    else if (type === 'UDP') {
        const jitter = Number(metrics.jitter_ms || 0);
        const loss = Number(metrics.loss_pct || 0);

        if (!reachable) {
            computedScore = 0;
            verdict = 'down';
            primaryReason = 'UDP test server unreachable.';
            factors.push({
                name: 'UDP Link',
                category: 'connectivity',
                value: 'Unreachable',
                impact: -100,
                status: 'penalty',
                detail: 'No return UDP stream received by iperf3.',
                isCritical: true
            });
        } else {
            const lossDed = Math.round(loss * 10 * 10) / 10;
            let jitterDed = 0;
            if (jitter > 30) {
                jitterDed = Math.min(50, Math.round((jitter - 30) * 0.7 * 10) / 10);
            }

            factors.push({
                name: 'Packet Loss',
                category: 'loss',
                value: `${loss.toFixed(1)}%`,
                impact: -lossDed,
                status: loss <= 0.5 ? 'optimal' : loss <= 3 ? 'warning' : 'penalty',
                detail: `-10 pts penalty per 1% packet loss. 10% loss = score 0.`,
                formula: `- (${loss.toFixed(1)}% × 10) = -${lossDed} pts`
            });

            factors.push({
                name: 'Jitter',
                category: 'jitter',
                value: `${jitter.toFixed(1)} ms`,
                impact: -jitterDed,
                status: jitter <= 15 ? 'optimal' : jitter <= 30 ? 'neutral' : 'warning',
                detail: jitter <= 30
                    ? 'Jitter within tolerance threshold (≤ 30 ms). No penalty.'
                    : `Excessive jitter (> 30 ms). Penalty of 0.7 pt per additional ms (max -50 pts).`,
                formula: jitter > 30 ? `- min(50, (${jitter.toFixed(1)} - 30) × 0.7) = -${jitterDed} pts` : 'jitter ≤ 30 ms ➔ 0 pt'
            });

            computedScore = Math.max(0, Math.min(100, Math.round(100 - (lossDed + jitterDed))));
            verdict = computedScore >= 80 ? 'optimal' : computedScore >= 60 ? 'good' : computedScore >= 40 ? 'degraded' : 'critical';
            primaryReason = computedScore >= 80
                ? 'Optimal UDP transmission quality.'
                : `UDP stream degraded due to ${loss > 0 ? `packet loss (${loss.toFixed(1)}%)` : ''}${loss > 0 && jitter > 30 ? ' and ' : ''}${jitter > 30 ? `jitter (${jitter.toFixed(1)} ms)` : ''}.`;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. CLOUD / Default Probes
    // ─────────────────────────────────────────────────────────────────────────────
    else {
        if (!reachable) {
            computedScore = 0;
            verdict = 'down';
            primaryReason = 'Cloudflare Worker / Cloud probe test execution failed.';
            factors.push({
                name: 'Cloud Scenario',
                category: 'connectivity',
                value: 'Failed',
                impact: -100,
                status: 'penalty',
                detail: 'Executed probe returned failure status.',
                isCritical: true
            });
        } else {
            computedScore = recordedScore !== undefined ? recordedScore : 100;
            verdict = computedScore >= 80 ? 'optimal' : computedScore >= 50 ? 'degraded' : 'critical';
            primaryReason = `Cloud synthetic score (${computedScore}/100).`;
            factors.push({
                name: 'Cloud Evaluation',
                category: 'connectivity',
                value: `${lat.toFixed(1)} ms`,
                impact: 0,
                status: 'optimal',
                detail: 'Aggregated result calculated by Stigix Target connector.'
            });
        }
    }

    const finalScore = recordedScore !== undefined ? recordedScore : computedScore;

    return {
        baseScore,
        finalScore,
        probeType: type,
        isReachable: reachable,
        verdict,
        primaryReason,
        summary: `DEM Score: ${finalScore}/100 (${verdict.toUpperCase()})`,
        factors,
        recommendations,
        allowedStatusCodes,
        receivedStatusCode: httpCode,
        canAddStatusCode,
        missingStatusCode
    };
}
