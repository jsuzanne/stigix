import { Router } from 'express';
import { RegistryInstance } from './stigix-registry-client.js';

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
                console.log(`[LOCAL-REGISTRY] Pruned stale instance: ${inst.instance_id}`);
            }
        }
    }

    getInstances(): RegistryInstance[] {
        return Array.from(this.instances.values());
    }

    getRouter(): Router {
        const router = Router();

        // POST /register
        router.post('/register', (req, res) => {
            const payload = req.body;
            if (!payload.instance_id || !payload.poc_id) {
                return res.status(400).json({ status: 'error', error: 'invalid_payload' });
            }

            const key = `poc:${payload.poc_id}:inst:${payload.instance_id}`;
            const instance: RegistryInstance = {
                ...payload,
                last_seen: new Date().toISOString()
            };

            this.instances.set(key, instance);
            // console.log(`[LOCAL-REGISTRY] Heartbeat from ${payload.instance_id} (${payload.ip_private})`);

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

            if (!poc_id) {
                return res.status(400).json({ status: 'error', error: 'missing_poc_id' });
            }

            const prefix = `poc:${poc_id}:inst:`;
            let results = Array.from(this.instances.entries())
                .filter(([key]) => key.startsWith(prefix))
                .map(([_, inst]) => inst);

            if (scope === 'others' && self_id) {
                results = results.filter(inst => inst.instance_id !== self_id);
            }

            return res.json({
                poc_id,
                instances: results
            });
        });

        return router;
    }
}
