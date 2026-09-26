import { Router } from 'express';
import { RegistryInstance } from './stigix-registry-client.js';
import { log } from './utils/logger.js';

/**
 * LocalRegistryServer - A lightweight in-memory registry for local peer discovery.
 * Replicates the essential Cloudflare Worker API to bypass global quotas.
 */
export class LocalRegistryServer {
    private instances: Map<string, RegistryInstance> = new Map();
    private ttlSeconds: number = 600; // 10 minutes TTL

    constructor() {
        // Periodic cleanup of stale heartbeats
        setInterval(() => this.cleanup(), 60000);
    }

    private cleanup() {
        const now = Date.now();
        for (const [key, inst] of this.instances.entries()) {
            const lastSeen = inst.last_seen ? new Date(inst.last_seen).getTime() : 0;
            if (now - lastSeen > this.ttlSeconds * 1000) {
                this.instances.delete(key);
                log('LOCAL-REGISTRY', `Pruned stale instance: ${inst.instance_id}`);
            }
        }
    }

    private provisioningManager: any = null;

    getInstances(): RegistryInstance[] {
        return Array.from(this.instances.values());
    }

    getRouter(targetsManager?: any, provisioningManager?: any): Router {
        this.provisioningManager = provisioningManager;
        const router = Router();

        // POST /register
        router.post('/register', (req, res) => {
            const payload = req.body;
            if (!payload.instance_id || !payload.poc_id) {
                return res.status(400).json({ status: 'error', error: 'invalid_payload' });
            }

            // Automatically purge old instance entry for the same IP if instance_id changed (e.g. after a site rename)
            if (payload.ip_private) {
                const prefix = `poc:${payload.poc_id}:inst:`;
                for (const [existingKey, existingInst] of this.instances.entries()) {
                    if (existingKey.startsWith(prefix) &&
                        existingInst.ip_private === payload.ip_private &&
                        existingInst.instance_id !== payload.instance_id) {
                        this.instances.delete(existingKey);
                        log('LOCAL-REGISTRY', `Replaced old instance "${existingInst.instance_id}" with renamed "${payload.instance_id}" for IP ${payload.ip_private}`);
                    }
                }
            }

            const key = `poc:${payload.poc_id}:inst:${payload.instance_id}`;
            const instance: RegistryInstance = {
                ...payload,
                last_seen: new Date().toISOString()
            };
            if (payload.summary?.provisioning_status) {
                (instance as any).provisioning_status = payload.summary.provisioning_status;
            }

            this.instances.set(key, instance);
            // log('LOCAL-REGISTRY', `Heartbeat from ${payload.instance_id} (${payload.ip_private})`);

            return res.json({
                status: 'ok',
                poc_id: payload.poc_id,
                instance_id: payload.instance_id
            });
        });

        // GET /instances
        router.get('/instances', (req, res) => {
            const poc_id = req.query.poc_id as string;
            const scope = req.query.scope as string;
            const self_id = req.query.self_instance_id as string;

            let results = Array.from(this.instances.values());

            // Filter by specific poc_id if provided and not a direct/local wildcard
            if (poc_id && !poc_id.startsWith('direct:') && poc_id !== 'local-leader') {
                const prefix = `poc:${poc_id}:inst:`;
                const filtered = Array.from(this.instances.entries())
                    .filter(([key]) => key.startsWith(prefix))
                    .map(([_, inst]) => inst);
                if (filtered.length > 0) {
                    results = filtered;
                }
            }

            if (scope === 'others' && self_id) {
                results = results.filter(inst => inst.instance_id !== self_id);
            }

            return res.json({
                poc_id: poc_id || 'local-leader',
                instances: results
            });
        });

        // GET /targets (Shared Targets from Leader to Peer)
        router.get('/targets', (req, res) => {
            if (!targetsManager) {
                return res.json([]);
            }
            try {
                // Get targets from the Leader's targetsManager.
                const targets = targetsManager.getMergedTargets();
                return res.json(targets);
            } catch (e) {
                log('LOCAL-REGISTRY', `Error serving targets: ${e}`, 'error');
                return res.status(500).json({ status: 'error', error: 'failed_to_get_targets' });
            }
        });

        // ─── Provisioning Endpoints (Leader → Peer Pull) ───

        // GET /provisioning/manifest
        router.get('/provisioning/manifest', (req, res) => {
            if (!provisioningManager) {
                return res.status(503).json({ error: 'provisioning_unavailable' });
            }
            return res.json(provisioningManager.getManifest());
        });

        // GET /provisioning/bundles/:type/:revision
        router.get('/provisioning/bundles/:type/:revision', (req, res) => {
            if (!provisioningManager) {
                return res.status(503).json({ error: 'provisioning_unavailable' });
            }
            const type = req.params.type as any;
            const revision = parseInt(req.params.revision, 10);
            if (isNaN(revision)) {
                return res.status(400).json({ error: 'invalid_revision' });
            }
            const bundle = provisioningManager.getPublishedBundle(type, revision);
            if (!bundle) {
                return res.status(404).json({ error: 'bundle_not_found' });
            }
            return res.json(bundle);
        });

        // POST /provisioning/status (Peer status update to Leader)
        router.post('/provisioning/status', (req, res) => {
            const { instance_id, status } = req.body;
            if (!instance_id || !status) {
                return res.status(400).json({ error: 'invalid_payload' });
            }

            // Find matching registered instance and attach provisioning status
            for (const inst of this.instances.values()) {
                if (inst.instance_id === instance_id) {
                    (inst as any).provisioning_status = {
                        ...status,
                        lastReportedAt: new Date().toISOString()
                    };
                    break;
                }
            }
            return res.json({ status: 'ok' });
        });

        // GET /fleet/overview (Federated Fleet Overview)
        router.get('/fleet/overview', (req, res) => {
            return res.json(this.getFleetOverview());
        });

        return router;
    }

    getFleetOverview(localLeaderId?: string) {
        const now = Date.now();
        const instances = Array.from(this.instances.values());
        
        let onlineCount = 0;
        let offlineCount = 0;

        const leaderState = this.provisioningManager ? this.provisioningManager.getState() : null;
        const leaderRevisions = leaderState?.appliedRevisions || {};
        const leaderBundleKeys = Object.keys(leaderRevisions);

        const enrichedInstances = instances.map(inst => {
            const isLeader = (localLeaderId && inst.instance_id === localLeaderId)
                || inst.type === 'leader'
                || (inst.instance_id && inst.instance_id.toLowerCase().includes('leader'));
            
            const lastSeenMs = inst.last_seen ? new Date(inst.last_seen).getTime() : 0;
            const diffSeconds = lastSeenMs > 0 ? Math.max(0, Math.round((now - lastSeenMs) / 1000)) : 999999;
            
            // If the instance is the local Leader hosting this registry server, it's always online
            const isStale = isLeader ? false : (diffSeconds > 90);
            const status: 'online' | 'offline' = isStale ? 'offline' : 'online';

            if (status === 'online') {
                onlineCount++;
            } else {
                offlineCount++;
            }

            // Determine Config Sync status relative to Leader
            let configSyncStatus: 'synced' | 'behind' | 'na' = 'na';
            let behindCount = 0;
            const peerProv = (inst as any).provisioning_status || inst.summary?.provisioning_status;
            const peerRevisions = peerProv?.appliedRevisions || {};

            if (isLeader) {
                configSyncStatus = 'synced';
            } else if (leaderBundleKeys.length > 0) {
                let allSynced = true;
                for (const bKey of leaderBundleKeys) {
                    const lRevObj = leaderRevisions[bKey];
                    const lRev = typeof lRevObj === 'object' ? lRevObj.revision : lRevObj;
                    const pRevObj = peerRevisions[bKey];
                    const pRev = typeof pRevObj === 'object' ? pRevObj.revision : pRevObj;
                    if (lRev && (!pRev || pRev < lRev)) {
                        allSynced = false;
                        behindCount++;
                    }
                }
                configSyncStatus = allSynced ? 'synced' : 'behind';
            } else if (Object.keys(peerRevisions).length > 0) {
                configSyncStatus = 'synced';
            }

            return {
                ...inst,
                is_leader: isLeader,
                status,
                is_stale: isStale,
                last_seen_seconds_ago: isLeader ? 0 : diffSeconds,
                config_sync_status: configSyncStatus,
                behind_bundles_count: behindCount,
                provisioning_status: peerProv
            };
        });

        // Sort: Leader first, then alphabetically by site/instance_id
        enrichedInstances.sort((a, b) => {
            if (a.is_leader && !b.is_leader) return -1;
            if (!a.is_leader && b.is_leader) return 1;
            const nameA = a.meta?.site || a.instance_id;
            const nameB = b.meta?.site || b.instance_id;
            return nameA.localeCompare(nameB);
        });

        const scoresWithValues = enrichedInstances
            .map(i => i.summary?.probes_global_health)
            .filter((s): s is number => typeof s === 'number' && !isNaN(s));
            
        const avgGlobalExperience = scoresWithValues.length > 0
            ? Math.round(scoresWithValues.reduce((a, b) => a + b, 0) / scoresWithValues.length)
            : null;

        return {
            total_instances: enrichedInstances.length,
            online_count: onlineCount,
            offline_count: offlineCount,
            avg_global_experience: avgGlobalExperience,
            leader_revisions: leaderRevisions,
            instances: enrichedInstances,
            generated_at: new Date().toISOString()
        };
    }
}
