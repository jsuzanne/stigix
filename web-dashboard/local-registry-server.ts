import { Router } from 'express';
import { RegistryInstance } from './stigix-registry-client.js';
import { log } from './utils/logger.js';

export interface ActiveCustomAppServer {
    node_id: string;
    node_name?: string;
    app_id: string;
    app_name: string;
    role: 'server';
    status: 'running' | 'stopped';
    port: number;
    protocol?: string;
    ip: string;
    is_eicar_responder?: boolean;
    eicar_mode?: 'http' | 'tcp_raw';
    pid?: number;
    updated_at: number;
}


/**
 * LocalRegistryServer - A lightweight in-memory registry for local peer discovery.
 * Replicates the essential Cloudflare Worker API to bypass global quotas.
 */
export class LocalRegistryServer {
    private instances: Map<string, RegistryInstance> = new Map();
    private activeCustomAppServers: Map<string, ActiveCustomAppServer> = new Map();
    private targetsManager: any = null;
    private ttlSeconds: number = 600; // 10 minutes TTL

    public setTargetsManager(targetsManager: any): void {
        this.targetsManager = targetsManager;
    }

    public updateCustomAppServer(server: ActiveCustomAppServer): void {
        if (!server || !server.app_id) return;
        
        // Auto-heal IP if 127.0.0.1 or empty
        if (!server.ip || server.ip === '127.0.0.1' || server.ip === 'localhost') {
            const inst = this.instances.get(server.node_id);
            if (inst && inst.ip_private && inst.ip_private !== '127.0.0.1') {
                server.ip = inst.ip_private;
            } else if (this.targetsManager) {
                const target = this.targetsManager.getMergedTargets().find((t: any) => 
                    t.name === server.node_name || t.id === server.node_id || t.name === server.node_id
                );
                if (target && target.host && target.host !== '127.0.0.1') {
                    server.ip = target.host;
                }
            }
        }

        const key = `${server.node_id || server.ip}:${server.app_id}`;
        const prev = this.activeCustomAppServers.get(key);
        const stateChanged = !prev || prev.status !== server.status || prev.ip !== server.ip || prev.port !== server.port;
        this.activeCustomAppServers.set(key, { ...server, updated_at: Date.now() });
        if (stateChanged) {
            log('LOCAL-REGISTRY', `Custom App Server ${server.status}: ${server.app_name} on ${server.node_id} (ip: ${server.ip}, port ${server.port})`);
        }
    }

    public removeCustomAppServersForNode(nodeId: string): void {
        for (const [key, server] of this.activeCustomAppServers.entries()) {
            if (server.node_id === nodeId || server.ip === nodeId) {
                this.activeCustomAppServers.delete(key);
            }
        }
    }

    public getCustomAppMesh(): ActiveCustomAppServer[] {
        return Array.from(this.activeCustomAppServers.values());
    }

    private onInstancesPruned?: () => void;
    public setOnInstancesPruned(cb: () => void): void {
        this.onInstancesPruned = cb;
    }

    constructor() {
        // Periodic cleanup of stale heartbeats
        setInterval(() => this.cleanup(), 60000);
    }

    private cleanup() {
        const now = Date.now();
        let pruned = false;
        for (const [key, inst] of this.instances.entries()) {
            const lastSeen = inst.last_seen ? new Date(inst.last_seen).getTime() : 0;
            if (now - lastSeen > this.ttlSeconds * 1000) {
                this.instances.delete(key);
                log('LOCAL-REGISTRY', `Pruned stale instance: ${inst.instance_id}`);
                pruned = true;
            }
        }
        if (pruned && this.onInstancesPruned) {
            this.onInstancesPruned();
        }
    }

    private provisioningManager: any = null;

    getInstances(): RegistryInstance[] {
        return Array.from(this.instances.values());
    }

    upsertInstance(instance: RegistryInstance, pocId: string = 'local-leader'): boolean {
        if (!instance || !instance.instance_id) return false;
        const targetPocId = instance.poc_id || pocId || 'local-leader';
        const key = instance.instance_id;

        // Check if an existing entry matches by ID or IP (always purge old keys if the peer/leader renamed its site)
        let matchedKey = key;
        if (instance.ip_private) {
            for (const [k, v] of this.instances.entries()) {
                if (v.ip_private === instance.ip_private && k !== key) {
                    matchedKey = k;
                    this.instances.delete(k);
                }
            }
        }

        const prev = this.instances.get(matchedKey);
        const isNewOrChanged = !prev || 
            prev.instance_id !== instance.instance_id ||
            prev.ip_private !== instance.ip_private ||
            (instance.meta?.site && prev.meta?.site !== instance.meta.site);

        const mergedInstance: RegistryInstance = {
            ...prev,
            ...instance,
            poc_id: targetPocId,
            summary: instance.summary || prev?.summary,
            meta: {
                ...prev?.meta,
                ...instance.meta
            },
            last_seen: new Date().toISOString()
        };

        if (matchedKey !== key) {
            this.instances.delete(matchedKey);
        }
        this.instances.set(key, mergedInstance);

        if (Array.isArray((instance as any).custom_app_servers)) {
            for (const s of (instance as any).custom_app_servers) {
                if (s && s.app_id) {
                    this.updateCustomAppServer(s);
                }
            }
        }

        return isNewOrChanged;
    }

    public updatePeerTunnelMetrics(
        instanceId: string, 
        rttMs: number, 
        lastPong: number, 
        direction?: string,
        sourceIp?: string,
        destIp?: string,
        sourcePort?: number,
        destPort?: number,
        ewmaRttMs?: number,
        jitterMs?: number,
        minRttMs?: number,
        maxRttMs?: number,
        pathProfile?: string
    ): void {
        let inst = this.instances.get(instanceId);
        if (!inst) {
            for (const [, v] of this.instances.entries()) {
                if (v.instance_id === instanceId || v.ip_private === instanceId || v.meta?.site === instanceId) {
                    inst = v;
                    break;
                }
            }
        }
        if (inst) {
            (inst as any).rtt_ms = rttMs;
            (inst as any).last_pong = new Date(lastPong).toISOString();
            if (ewmaRttMs !== undefined) (inst as any).ewma_rtt_ms = ewmaRttMs;
            if (jitterMs !== undefined) (inst as any).jitter_ms = jitterMs;
            if (minRttMs !== undefined) (inst as any).min_rtt_ms = minRttMs;
            if (maxRttMs !== undefined) (inst as any).max_rtt_ms = maxRttMs;
            if (pathProfile) (inst as any).tunnel_path_profile = pathProfile;
            if (direction) {
                (inst as any).tunnel_direction = direction;
            }
            if (sourceIp) {
                (inst as any).tunnel_source_ip = sourceIp;
            }
            if (destIp) {
                (inst as any).tunnel_dest_ip = destIp;
            }
            if (sourcePort) {
                (inst as any).tunnel_source_port = sourcePort;
            }
            if (destPort) {
                (inst as any).tunnel_dest_port = destPort;
            }
            if (!inst.meta) inst.meta = {};
            inst.meta.rtt_ms = rttMs;
            inst.meta.last_pong = (inst as any).last_pong;
            if (ewmaRttMs !== undefined) inst.meta.ewma_rtt_ms = ewmaRttMs;
            if (jitterMs !== undefined) inst.meta.jitter_ms = jitterMs;
            if (minRttMs !== undefined) inst.meta.min_rtt_ms = minRttMs;
            if (maxRttMs !== undefined) inst.meta.max_rtt_ms = maxRttMs;
            if (pathProfile) inst.meta.tunnel_path_profile = pathProfile;
            if (direction) inst.meta.tunnel_direction = direction;
            if (sourceIp) inst.meta.tunnel_source_ip = sourceIp;
            if (destIp) inst.meta.tunnel_dest_ip = destIp;
            if (sourcePort) inst.meta.tunnel_source_port = sourcePort;
            if (destPort) inst.meta.tunnel_dest_port = destPort;
        }
    }

    public updateInstanceProvisioningAck(instanceId: string, ack: { bundleType: string; revision: number; status: string }): void {
        let inst = this.instances.get(instanceId);
        if (!inst) {
            for (const [, v] of this.instances.entries()) {
                if (v.instance_id === instanceId || v.ip_private === instanceId || v.meta?.site === instanceId) {
                    inst = v;
                    break;
                }
            }
        }
        if (inst) {
            if (!inst.meta) inst.meta = {};
            inst.meta.sync_ack = {
                bundleType: ack.bundleType,
                revision: ack.revision,
                status: ack.status,
                ackAt: new Date().toISOString()
            };
        }
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

            const key = payload.instance_id;

            // Automatically purge old instance entry for the same IP if instance_id changed (e.g. after a site rename)
            if (payload.ip_private) {
                for (const [existingKey, existingInst] of this.instances.entries()) {
                    if (existingInst.ip_private === payload.ip_private && existingKey !== key) {
                        this.instances.delete(existingKey);
                        log('LOCAL-REGISTRY', `Replaced old instance "${existingKey}" with renamed "${key}" for IP ${payload.ip_private}`);
                    }
                }
            }

            const prev = this.instances.get(key);
            const instance: RegistryInstance = {
                ...prev,
                ...payload,
                type: prev?.type === 'leader' ? 'leader' : payload.type,
                meta: {
                    ...prev?.meta,
                    ...payload.meta,
                    ...(prev?.meta?.is_leader ? { is_leader: true } : {})
                },
                last_seen: new Date().toISOString()
            };
            if (payload.summary?.provisioning_status) {
                (instance as any).provisioning_status = payload.summary.provisioning_status;
            }

            this.instances.set(key, instance);

            if (targetsManager && payload.ip_private) {
                if (typeof targetsManager.syncPeerInstance === 'function') {
                    targetsManager.syncPeerInstance(payload.instance_id, payload.meta?.site || payload.instance_id, payload.ip_private);
                }
                if (typeof targetsManager.updateHostName === 'function') {
                    targetsManager.updateHostName(payload.ip_private, payload.meta?.site || payload.instance_id);
                }
            }

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
            return res.json(provisioningManager.ensureLeaderManifestSynced());
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
            provisioningManager.ensureLeaderManifestSynced();
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

        // GET /custom-app-mesh (Live active custom app servers in fleet)
        router.get('/custom-app-mesh', (req, res) => {
            return res.json({
                servers: this.getCustomAppMesh(),
                count: this.activeCustomAppServers.size,
                generated_at: new Date().toISOString()
            });
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

        const leaderManifest = this.provisioningManager ? this.provisioningManager.ensureLeaderManifestSynced() : null;
        const leaderState = this.provisioningManager ? this.provisioningManager.getState() : null;
        const leaderRevisions: Record<string, any> = { ...(leaderState?.appliedRevisions || {}) };
        if (Array.isArray(leaderManifest?.bundles)) {
            for (const b of leaderManifest.bundles) {
                if (b && b.type) {
                    leaderRevisions[b.type] = {
                        revision: b.revision,
                        checksum: b.checksum,
                        updatedAt: b.updatedAt,
                        status: 'applied'
                    };
                }
            }
        }
        const leaderBundleKeys = Object.keys(leaderRevisions);

        const enrichedInstances = instances.map(inst => {
            const isLeader = localLeaderId
                ? inst.instance_id === localLeaderId
                : (inst.type === 'leader' || Boolean(inst.instance_id && inst.instance_id.toLowerCase().includes('leader')));
            const isRemoteLeader = !isLeader && inst.type === 'leader';
            
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
                    if (bKey === 'pcap-profiles' && peerProv?.pcap_replay_enabled === false) {
                        continue;
                    }
                    const lRevObj = leaderRevisions[bKey];
                    const lRev = typeof lRevObj === 'object' ? lRevObj.revision : lRevObj;
                    const pRevObj = peerRevisions[bKey];
                    const pRev = typeof pRevObj === 'object' ? pRevObj.revision : pRevObj;
                    const pFailed = typeof pRevObj === 'object' && pRevObj?.status === 'failed';
                    if (lRev && (!pRev || pRev !== lRev || pFailed)) {
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
                rtt_ms: (inst as any).rtt_ms ?? inst.meta?.rtt_ms,
                last_pong: (inst as any).last_pong ?? inst.meta?.last_pong,
                tunnel_direction: (inst as any).tunnel_direction ?? inst.meta?.tunnel_direction ?? (isLeader ? 'leader' : 'inbound'),
                tunnel_source_ip: (inst as any).tunnel_source_ip ?? inst.meta?.tunnel_source_ip,
                tunnel_dest_ip: (inst as any).tunnel_dest_ip ?? inst.meta?.tunnel_dest_ip,
                tunnel_source_port: (inst as any).tunnel_source_port ?? inst.meta?.tunnel_source_port,
                tunnel_dest_port: (inst as any).tunnel_dest_port ?? inst.meta?.tunnel_dest_port,
                is_leader: isLeader,
                is_remote_leader: isRemoteLeader,
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
            .filter(i => !i.is_stale && i.status === 'online' && !i.summary?.probes_paused)
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
