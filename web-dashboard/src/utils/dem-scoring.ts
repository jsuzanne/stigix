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
    let primaryReason = 'Sonde pleinement opérationnelle avec d’excellentes métriques de performance.';
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
            primaryReason = 'Échec de connexion réseau (hôte inaccessible, DNS introuvable ou socket rejetée).';
            factors.push({
                name: 'Connectivité',
                category: 'connectivity',
                value: 'Inaccessible',
                impact: -100,
                status: 'penalty',
                detail: 'Aucun paquet HTTP reçu. Connexion interrompue avant la réponse applicative.',
                isCritical: true
            });
            recommendations.push('Vérifiez l’URL ciblée, la résolution DNS et l’accès WAN du nœud Stigix.');
        } else if (lat >= 5000) {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `Délai d’attente dépassé (Timeout ${lat.toFixed(0)} ms ≥ 5 000 ms).`;
            factors.push({
                name: 'Délai d’attente',
                category: 'latency',
                value: `${lat.toFixed(0)} ms`,
                impact: -100,
                status: 'penalty',
                detail: 'Le temps de réponse a dépassé le seuil de coupure SLA de 5 secondes.',
                isCritical: true
            });
            recommendations.push('Augmentez le timeout de la sonde si l’API est naturellement lourde, ou inspectez les goulots d’étranglement.');
        } else if (cmEnabled && cmOk === false) {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `Échec de validation du corps HTTP (Content Match : ${cmRes || 'texte absent'}).`;
            factors.push({
                name: 'Content Match',
                category: 'content',
                value: `Attendu: "${cm.value}"`,
                impact: -100,
                status: 'penalty',
                detail: `Le test de contenu (${cm.mode || 'contains'}) a échoué. Réponse : ${cmRes || 'non conforme'}.`,
                isCritical: true
            });
            recommendations.push(`Ajustez la chaîne de texte recherchée ("${cm.value}") ou vérifiez le contenu de la page retournée.`);
        } else {
            // Status code validation
            const isExpected = allowedStatusCodes.includes(httpCode);

            if (!isExpected) {
                missingStatusCode = httpCode;
                canAddStatusCode = true;

                if (httpCode >= 500) {
                    computedScore = 0;
                    verdict = 'critical';
                    primaryReason = `Erreur interne du serveur cible (Code HTTP ${httpCode}).`;
                    factors.push({
                        name: 'Code HTTP (5xx)',
                        category: 'status_code',
                        value: `HTTP ${httpCode}`,
                        impact: -100,
                        status: 'penalty',
                        detail: `Erreur critique côté serveur applicatif. Codes attendus : [${allowedStatusCodes.join(', ')}].`,
                        isCritical: true
                    });
                    recommendations.push(`Le serveur distant a généré une erreur 5xx. Inspectez les logs backend du service ${probe?.target || ''}.`);
                } else if (httpCode >= 400) {
                    computedScore = 20;
                    verdict = 'degraded';
                    primaryReason = httpCode === 429
                        ? `Limitation de débit détectée (HTTP 429 Too Many Requests). Score bridé à 20.`
                        : `Code HTTP d’erreur client non attendu (HTTP ${httpCode}). Score bridé à 20.`;

                    factors.push({
                        name: `Code HTTP ${httpCode}`,
                        category: 'status_code',
                        value: `HTTP ${httpCode}`,
                        impact: -80,
                        status: 'penalty',
                        detail: httpCode === 429
                            ? `Le service cible bloque les requêtes par rate-limiting (429). Stigix bride le score à 20 par sécurité.`
                            : `Ce code n'est pas dans la liste des codes autorisés [${allowedStatusCodes.join(', ')}]. Score plafonné à 20.`,
                        isCritical: true
                    });

                    if (httpCode === 429) {
                        recommendations.push('Si le code 429 est attendu pour ce test, autorisez le code 429 dans la configuration de la sonde.');
                        recommendations.push('Sinon, augmentez l’intervalle de scrutation (fréquence) pour ne pas déclencher le rate-limiter.');
                    } else {
                        recommendations.push(`Si le code ${httpCode} est un statut valide pour ce endpoint, ajoutez-le à la liste des codes autorisés.`);
                    }
                } else {
                    computedScore = 20;
                    verdict = 'degraded';
                    primaryReason = `Code de redirection ou d’état inhabituel (HTTP ${httpCode}). Score bridé à 20.`;
                    factors.push({
                        name: 'Code HTTP',
                        category: 'status_code',
                        value: `HTTP ${httpCode}`,
                        impact: -80,
                        status: 'penalty',
                        detail: `Code inattendu reçu. Codes attendus : [${allowedStatusCodes.join(', ')}].`,
                        isCritical: true
                    });
                    recommendations.push(`Ajoutez ${httpCode} dans la configuration de la sonde si cette réponse est normale.`);
                }
            } else {
                // Expected HTTP Code: full math breakdown
                factors.push({
                    name: 'Code HTTP',
                    category: 'status_code',
                    value: `HTTP ${httpCode}`,
                    impact: 0,
                    status: 'optimal',
                    detail: `Code de statut conforme aux attentes autorisées [${allowedStatusCodes.join(', ')}].`
                });

                if (ttfb <= 0 && lat > 0) {
                    computedScore = 0;
                    verdict = 'critical';
                    primaryReason = 'Connexion interrompue avant la réception du premier octet (TTFB = 0).';
                    factors.push({
                        name: 'TTFB Interrompu',
                        category: 'ttfb',
                        value: '0 ms',
                        impact: -100,
                        status: 'penalty',
                        detail: 'Le serveur a fermé la socket prématurément avant de répondre.',
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
                        name: 'Latence Totale',
                        category: 'latency',
                        value: `${lat.toFixed(1)} ms`,
                        impact: -totalDed,
                        status: totalDed <= 5 ? 'optimal' : totalDed <= 15 ? 'warning' : 'penalty',
                        detail: `Poids max : -30 pts. Normalisé sur 2 000 ms (${Math.round(total_norm * 100)}% du plafond).`,
                        formula: `- (30 × min(${lat.toFixed(1)} / 2000, 1.0)) = -${totalDed} pts`
                    });

                    // TTFB factor (max -35)
                    factors.push({
                        name: 'TTFB (Backend)',
                        category: 'ttfb',
                        value: `${ttfb.toFixed(1)} ms`,
                        impact: -ttfbDed,
                        status: ttfbDed <= 6 ? 'optimal' : ttfbDed <= 18 ? 'warning' : 'penalty',
                        detail: `Poids max : -35 pts. Normalisé sur 1 000 ms. Reflète la réactivité du serveur applicatif.`,
                        formula: `- (35 × min(${ttfb.toFixed(1)} / 1000, 1.0)) = -${ttfbDed} pts`
                    });

                    // TLS factor (max -25)
                    if (type === 'HTTPS' || tls > 0) {
                        factors.push({
                            name: 'Handshake TLS',
                            category: 'tls',
                            value: `${tls.toFixed(1)} ms`,
                            impact: -tlsDed,
                            status: tlsDed <= 4 ? 'optimal' : tlsDed <= 12 ? 'warning' : 'penalty',
                            detail: `Poids max : -25 pts. Normalisé sur 800 ms. Un TLS élevé indique une inspection SASE ou un chemin lourd.`,
                            formula: `- (25 × min(${tls.toFixed(1)} / 800, 1.0)) = -${tlsDed} pts`
                        });
                    }

                    computedScore = Math.max(0, Math.min(100, Math.round(100 - (totalDed + ttfbDed + tlsDed))));

                    if (computedScore >= 90) {
                        verdict = 'optimal';
                        primaryReason = 'Excellente réactivité applicative et réseau (score > 90).';
                    } else if (computedScore >= 75) {
                        verdict = 'good';
                        primaryReason = 'Performances globales satisfaisantes avec un léger ralentissement mesuré.';
                    } else if (computedScore >= 50) {
                        verdict = 'degraded';
                        primaryReason = 'Latence ou temps de traitement backend dégradé.';
                        if (ttfbDed > 15) recommendations.push('Le TTFB est élevé : optimisez les temps de réponse du serveur cible.');
                        if (tlsDed > 10) recommendations.push('La négociation TLS est lente : vérifiez la négociation de certificats ou l’inspection intermédiaire.');
                    } else {
                        verdict = 'critical';
                        primaryReason = 'Latence excessive proche des seuils d’alerte SLA.';
                        recommendations.push('Vérifiez l’infrastructure d’hébergement et les goulots d’étranglement réseau.');
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
            primaryReason = 'Perte de paquets totale (100% Packet Loss). Hôte injoignable via ICMP.';
            factors.push({
                name: 'Écho ICMP',
                category: 'loss',
                value: 'Perte 100%',
                impact: -100,
                status: 'penalty',
                detail: 'Aucun écho ICMP reçu avant expiration du timeout.',
                isCritical: true
            });
            recommendations.push('Vérifiez si l’hôte distant ou un pare-feu bloque le protocole ICMP.');
        } else if (lat < 100) {
            computedScore = 100;
            verdict = 'optimal';
            primaryReason = `Latence ICMP excellente (${lat.toFixed(1)} ms < 100 ms). Aucun malus appliqué.`;
            factors.push({
                name: 'Latence ICMP',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: 0,
                status: 'optimal',
                detail: 'Seuil SLA optimal : sous 100 ms, aucun point n’est retiré.',
                formula: 'lat < 100 ms ➔ Score 100/100'
            });
        } else if (lat <= 500) {
            const ded = Math.round(((lat - 100) / 400) * 100 * 10) / 10;
            computedScore = Math.max(0, Math.min(100, Math.round(100 - ded)));
            verdict = computedScore >= 70 ? 'good' : 'degraded';
            primaryReason = `Latence modérée (${lat.toFixed(1)} ms). Déduction dégressive appliquée.`;
            factors.push({
                name: 'Latence ICMP',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -ded,
                status: ded <= 25 ? 'warning' : 'penalty',
                detail: `Déduction linéaire entre 100 ms et 500 ms sur une plage de 400 ms.`,
                formula: `100 - ((${lat.toFixed(1)} - 100) / 400) × 100 = ${computedScore}/100`
            });
            if (computedScore < 70) recommendations.push('Vérifiez l’acheminement WAN ou le jitter sur ce lien.');
        } else {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `Latence excessive (${lat.toFixed(1)} ms > 500 ms). Dépassement du SLA Ping.`;
            factors.push({
                name: 'Latence ICMP',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -100,
                status: 'penalty',
                detail: 'Tout ping supérieur à 500 ms est sanctionné d’un score 0.',
                isCritical: true
            });
            recommendations.push('La latence réseau dépasse les limites tolérées pour une liaison SD-WAN.');
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. TCP Connect Probes
    // ─────────────────────────────────────────────────────────────────────────────
    else if (type === 'TCP') {
        if (!reachable) {
            computedScore = 0;
            verdict = 'down';
            primaryReason = 'Port TCP fermé, filtré ou connexion refusée.';
            factors.push({
                name: 'TCP Handshake',
                category: 'connectivity',
                value: 'Échec',
                impact: -100,
                status: 'penalty',
                detail: 'Le SYN/ACK TCP n’a pas abouti avant le délai d’attente.',
                isCritical: true
            });
            recommendations.push('Vérifiez que le service écoute bien sur le port spécifié et les ACLs réseau.');
        } else if (lat < 150) {
            computedScore = 100;
            verdict = 'optimal';
            primaryReason = `Établissement TCP ultra-rapide (${lat.toFixed(1)} ms < 150 ms).`;
            factors.push({
                name: 'TCP Connect',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: 0,
                status: 'optimal',
                detail: 'Seuil SLA TCP : sous 150 ms, score parfait 100/100.',
                formula: 'lat < 150 ms ➔ Score 100/100'
            });
        } else if (lat <= 800) {
            const ded = Math.round(((lat - 150) / 650) * 100 * 10) / 10;
            computedScore = Math.max(0, Math.min(100, Math.round(100 - ded)));
            verdict = computedScore >= 70 ? 'good' : 'degraded';
            primaryReason = `Connexion TCP ralentie (${lat.toFixed(1)} ms).`;
            factors.push({
                name: 'TCP Connect',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -ded,
                status: ded <= 25 ? 'warning' : 'penalty',
                detail: `Déduction linéaire entre 150 ms et 800 ms sur une plage de 650 ms.`,
                formula: `100 - ((${lat.toFixed(1)} - 150) / 650) × 100 = ${computedScore}/100`
            });
        } else {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `Délai TCP Connect excessif (${lat.toFixed(1)} ms > 800 ms).`;
            factors.push({
                name: 'TCP Connect',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -100,
                status: 'penalty',
                detail: 'Au-delà de 800 ms de handshake TCP, le score tombe à 0.',
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
            primaryReason = 'Échec de résolution DNS (SERVFAIL, timeout ou requête sans réponse).';
            factors.push({
                name: 'Requête DNS',
                category: 'connectivity',
                value: 'Échec',
                impact: -100,
                status: 'penalty',
                detail: 'Le serveur DNS interrogé n’a retourné aucun enregistrement.',
                isCritical: true
            });
            recommendations.push('Vérifiez l’IP du résolveur DNS et l’autorisation UDP/TCP 53.');
        } else if (lat < 80) {
            computedScore = 100;
            verdict = 'optimal';
            primaryReason = `Résolution DNS instantanée (${lat.toFixed(1)} ms < 80 ms).`;
            factors.push({
                name: 'Temps de Résolution',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: 0,
                status: 'optimal',
                detail: 'Seuil SLA DNS : sous 80 ms, score 100/100.',
                formula: 'lat < 80 ms ➔ Score 100/100'
            });
        } else if (lat <= 400) {
            const ded = Math.round(((lat - 80) / 320) * 100 * 10) / 10;
            computedScore = Math.max(0, Math.min(100, Math.round(100 - ded)));
            verdict = computedScore >= 70 ? 'good' : 'degraded';
            primaryReason = `Résolution DNS ralentie (${lat.toFixed(1)} ms).`;
            factors.push({
                name: 'Temps de Résolution',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -ded,
                status: ded <= 25 ? 'warning' : 'penalty',
                detail: `Déduction linéaire entre 80 ms et 400 ms sur une plage de 320 ms.`,
                formula: `100 - ((${lat.toFixed(1)} - 80) / 320) × 100 = ${computedScore}/100`
            });
        } else {
            computedScore = 0;
            verdict = 'critical';
            primaryReason = `Résolution DNS excessivement lente (${lat.toFixed(1)} ms > 400 ms).`;
            factors.push({
                name: 'Temps de Résolution',
                category: 'latency',
                value: `${lat.toFixed(1)} ms`,
                impact: -100,
                status: 'penalty',
                detail: 'Au-delà de 400 ms de résolution DNS, le score tombe à 0.',
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
            primaryReason = 'Serveur de test UDP inaccessible.';
            factors.push({
                name: 'Liaison UDP',
                category: 'connectivity',
                value: 'Injoignable',
                impact: -100,
                status: 'penalty',
                detail: 'Aucun flux UDP reçu en retour par iperf3.',
                isCritical: true
            });
        } else {
            const lossDed = Math.round(loss * 10 * 10) / 10;
            let jitterDed = 0;
            if (jitter > 30) {
                jitterDed = Math.min(50, Math.round((jitter - 30) * 0.7 * 10) / 10);
            }

            factors.push({
                name: 'Perte de Paquets',
                category: 'loss',
                value: `${loss.toFixed(1)}%`,
                impact: -lossDed,
                status: loss <= 0.5 ? 'optimal' : loss <= 3 ? 'warning' : 'penalty',
                detail: `Sanction de -10 pts par tranche de 1% de perte. 10% de perte = score 0.`,
                formula: `- (${loss.toFixed(1)}% × 10) = -${lossDed} pts`
            });

            factors.push({
                name: 'Gigue (Jitter)',
                category: 'jitter',
                value: `${jitter.toFixed(1)} ms`,
                impact: -jitterDed,
                status: jitter <= 15 ? 'optimal' : jitter <= 30 ? 'neutral' : 'warning',
                detail: jitter <= 30
                    ? 'Gigue sous le seuil de tolérance (≤ 30 ms). Aucun malus.'
                    : `Gigue excessive (> 30 ms). Malus de 0.7 pt par ms supplémentaire (max -50 pts).`,
                formula: jitter > 30 ? `- min(50, (${jitter.toFixed(1)} - 30) × 0.7) = -${jitterDed} pts` : 'jitter ≤ 30 ms ➔ 0 pt'
            });

            computedScore = Math.max(0, Math.min(100, Math.round(100 - (lossDed + jitterDed))));
            verdict = computedScore >= 80 ? 'optimal' : computedScore >= 60 ? 'good' : computedScore >= 40 ? 'degraded' : 'critical';
            primaryReason = computedScore >= 80
                ? 'Qualité de transmission UDP optimale.'
                : `Altération de flux UDP liée à ${loss > 0 ? `des pertes (${loss.toFixed(1)}%)` : ''}${loss > 0 && jitter > 30 ? ' et ' : ''}${jitter > 30 ? `de la gigue (${jitter.toFixed(1)} ms)` : ''}.`;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. CLOUD / Default Probes
    // ─────────────────────────────────────────────────────────────────────────────
    else {
        if (!reachable) {
            computedScore = 0;
            verdict = 'down';
            primaryReason = 'Sonde Cloudflare / Scénario Cloud non exécuté ou en échec.';
            factors.push({
                name: 'Scénario Cloud',
                category: 'connectivity',
                value: 'Échec',
                impact: -100,
                status: 'penalty',
                detail: 'Le probe exécuté a retourné un statut négatif.',
                isCritical: true
            });
        } else {
            computedScore = recordedScore !== undefined ? recordedScore : 100;
            verdict = computedScore >= 80 ? 'optimal' : computedScore >= 50 ? 'degraded' : 'critical';
            primaryReason = `Résultat synthétique Cloudflare (${computedScore}/100).`;
            factors.push({
                name: 'Évaluation Cloud',
                category: 'connectivity',
                value: `${lat.toFixed(1)} ms`,
                impact: 0,
                status: 'optimal',
                detail: 'Résultat agrégé calculé par le connecteur Stigix Target.'
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
        summary: `Score DEM : ${finalScore}/100 (${verdict.toUpperCase()})`,
        factors,
        recommendations,
        allowedStatusCodes,
        receivedStatusCode: httpCode,
        canAddStatusCode,
        missingStatusCode
    };
}
