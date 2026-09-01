import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { log } from './utils/logger.js';

export interface ProvisioningManifestBundle {
    type: 'applications' | 'connectivity-probes';
    revision: number;
    checksum: string;
    updatedAt: string;
    count: number;
}

export interface ProvisioningManifest {
    schemaVersion: number;
    updatedAt: string;
    bundles: ProvisioningManifestBundle[];
}

export interface SyncDiffItem {
    id: string;
    name: string;
    action: 'added' | 'removed' | 'modified';
    details?: string;
}

export interface SyncHistoryEntry {
    id: string;
    type: 'applications' | 'connectivity-probes';
    revision: number;
    timestamp: string;
    diff: SyncDiffItem[];
    summary: { added: number; removed: number; modified: number };
}

export interface PeerProvisioningState {
    enabled: boolean;
    appliedRevisions: {
        [bundleType: string]: {
            revision: number;
            checksum: string;
            appliedAt: string;
            status: 'applied' | 'failed' | 'pending';
            error?: string;
        };
    };
    orphans: {
        [bundleType: string]: string[]; // array of item IDs
    };
    history?: SyncHistoryEntry[];
}

export class ProvisioningManager {
    private configDir: string;
    private stateDir: string;
    private globalDir: string;
    private overridesDir: string;
    private backupsDir: string;
    private stateFile: string;
    private manifestFile: string;

    constructor(configDir: string) {
        this.configDir = configDir;
        this.stateDir = path.join(configDir, '.stigix-provisioning');
        this.globalDir = path.join(this.stateDir, 'global');
        this.overridesDir = path.join(this.stateDir, 'local-overrides');
        this.backupsDir = path.join(this.stateDir, 'backups');
        this.stateFile = path.join(this.stateDir, 'state.json');
        this.manifestFile = path.join(this.stateDir, 'manifest.json');

        this.initDirectories();
    }

    private initDirectories(): void {
        try {
            fs.mkdirSync(this.stateDir, { recursive: true });
            fs.mkdirSync(this.globalDir, { recursive: true });
            fs.mkdirSync(path.join(this.globalDir, 'applications'), { recursive: true });
            fs.mkdirSync(path.join(this.globalDir, 'connectivity-probes'), { recursive: true });
            fs.mkdirSync(this.overridesDir, { recursive: true });
            fs.mkdirSync(this.backupsDir, { recursive: true });

            if (!fs.existsSync(this.stateFile)) {
                const defaultState: PeerProvisioningState = {
                    enabled: false, // Default OFF for existing instances (safe opt-in)
                    appliedRevisions: {},
                    orphans: {}
                };
                fs.writeFileSync(this.stateFile, JSON.stringify(defaultState, null, 2), 'utf8');
            }

            if (!fs.existsSync(this.manifestFile)) {
                const defaultManifest: ProvisioningManifest = {
                    schemaVersion: 1,
                    updatedAt: new Date().toISOString(),
                    bundles: []
                };
                fs.writeFileSync(this.manifestFile, JSON.stringify(defaultManifest, null, 2), 'utf8');
            }
        } catch (e: any) {
            log('PROVISIONING', `Failed to initialize provisioning directories: ${e.message}`, 'error');
        }
    }

    // ─── ID Normalization ────────────────────────────────────────────────────────

    public generateDeterministicId(type: 'applications' | 'connectivity-probes', item: any): string {
        if (item.id && typeof item.id === 'string' && item.id.trim()) {
            return item.id.trim();
        }
        if (type === 'applications') {
            const domain = (item.domain || '').toLowerCase().trim();
            const endpoint = (item.endpoint || '/').toLowerCase().trim();
            const raw = `app:${domain}:${endpoint}`;
            const hash = crypto.createHash('md5').update(raw).digest('hex').substring(0, 10);
            return `app-${hash}`;
        } else {
            const probeType = (item.type || 'PING').toUpperCase().trim();
            const name = (item.name || '').toLowerCase().trim();
            const raw = `probe:${probeType}:${name}`;
            const hash = crypto.createHash('md5').update(raw).digest('hex').substring(0, 10);
            return `probe-${hash}`;
        }
    }

    public normalizeItemsWithIds(type: 'applications' | 'connectivity-probes', items: any[]): any[] {
        if (!Array.isArray(items)) return [];
        const result: any[] = [];
        let currentCategory = 'Uncategorized';

        for (const item of items) {
            if (type === 'applications') {
                if (typeof item === 'string') {
                    const line = item.trim();
                    if (!line) continue;
                    if (line.startsWith('#')) {
                        const comment = line.substring(1).trim();
                        if (!comment.toLowerCase().startsWith('format:') && !comment.toLowerCase().startsWith('weight:')) {
                            currentCategory = comment;
                        }
                        continue;
                    }
                    const parts = line.split('|');
                    if (parts.length >= 2) {
                        const domain = parts[0].trim();
                        const weight = parseInt(parts[1], 10) || 50;
                        const endpoint = parts[2] ? parts[2].trim() : '/';
                        const obj = { domain, weight, endpoint, category: currentCategory };
                        const id = this.generateDeterministicId('applications', obj);
                        result.push({ ...obj, id });
                    }
                } else if (item && typeof item === 'object' && item.domain) {
                    const id = this.generateDeterministicId('applications', item);
                    result.push({ ...item, id });
                }
            } else {
                if (item && typeof item === 'object') {
                    const id = this.generateDeterministicId('connectivity-probes', item);
                    result.push({ ...item, id });
                }
            }
        }
        return result;
    }

    private computeChecksum(data: any): string {
        const normalized = Array.isArray(data)
            ? data.map(item => {
                if (typeof item !== 'object' || item === null) return item;
                const keys = Object.keys(item).sort();
                const sortedObj: any = {};
                for (const k of keys) {
                    if (k !== '_source' && k !== '_wasGlobal') {
                        sortedObj[k] = item[k];
                    }
                }
                return sortedObj;
            })
            : data;
        const str = JSON.stringify(normalized);
        return 'sha256:' + crypto.createHash('sha256').update(str).digest('hex');
    }

    // ─── State Management ────────────────────────────────────────────────────────

    public getState(): PeerProvisioningState {
        try {
            if (fs.existsSync(this.stateFile)) {
                return JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            }
        } catch {}
        return { enabled: false, appliedRevisions: {}, orphans: {} };
    }

    public saveState(state: PeerProvisioningState): void {
        try {
            fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf8');
        } catch (e: any) {
            log('PROVISIONING', `Failed to save state.json: ${e.message}`, 'error');
        }
    }

    public setEnabled(enabled: boolean): PeerProvisioningState {
        const state = this.getState();
        state.enabled = enabled;
        this.saveState(state);
        log('PROVISIONING', `Global provisioning set to: ${enabled ? 'ENABLED' : 'DISABLED'}`);
        return state;
    }

    // ─── Leader Publishing ───────────────────────────────────────────────────────

    public getManifest(): ProvisioningManifest {
        try {
            if (fs.existsSync(this.manifestFile)) {
                return JSON.parse(fs.readFileSync(this.manifestFile, 'utf8'));
            }
        } catch {}
        return { schemaVersion: 1, updatedAt: new Date().toISOString(), bundles: [] };
    }

    private saveManifest(manifest: ProvisioningManifest): void {
        fs.writeFileSync(this.manifestFile, JSON.stringify(manifest, null, 2), 'utf8');
    }

    public publishBundle(type: 'applications' | 'connectivity-probes', rawItems: any[]): { revision: number; checksum: string; count: number } {
        const normalized = this.normalizeItemsWithIds(type, rawItems);
        const checksum = this.computeChecksum(normalized);
        const manifest = this.getManifest();
        const existingBundle = manifest.bundles.find(b => b.type === type);
        const nextRev = (existingBundle ? existingBundle.revision : 0) + 1;

        // Write immutable revision bundle
        const revFile = path.join(this.globalDir, type, `rev-${nextRev}.json`);
        fs.writeFileSync(revFile, JSON.stringify(normalized, null, 2), 'utf8');

        // Bounded retention: keep last 10 revisions
        const typeDir = path.join(this.globalDir, type);
        const files = fs.readdirSync(typeDir).filter(f => f.startsWith('rev-') && f.endsWith('.json'));
        if (files.length > 10) {
            files.sort((a, b) => {
                const numA = parseInt(a.replace('rev-', '').replace('.json', ''), 10);
                const numB = parseInt(b.replace('rev-', '').replace('.json', ''), 10);
                return numA - numB;
            });
            while (files.length > 10) {
                const oldest = files.shift();
                if (oldest) {
                    try { fs.unlinkSync(path.join(typeDir, oldest)); } catch {}
                }
            }
        }

        // Compute diff against previous published bundle for Leader audit history
        const previousBundle = (existingBundle && existingBundle.revision)
            ? (this.getPublishedBundle(type, existingBundle.revision) || [])
            : [];
        const { diff, summary } = this.computeDiff(type, previousBundle, normalized);

        // Update manifest
        const now = new Date().toISOString();
        const bundleEntry: ProvisioningManifestBundle = {
            type,
            revision: nextRev,
            checksum,
            updatedAt: now,
            count: normalized.length
        };

        const idx = manifest.bundles.findIndex(b => b.type === type);
        if (idx !== -1) {
            manifest.bundles[idx] = bundleEntry;
        } else {
            manifest.bundles.push(bundleEntry);
        }
        manifest.updatedAt = now;
        this.saveManifest(manifest);

        // Save history entry on Leader
        const state = this.getState();
        if (!state.history) state.history = [];
        state.history.unshift({
            id: `${type}-rev-${nextRev}-${Date.now()}`,
            type,
            revision: nextRev,
            timestamp: now,
            diff,
            summary
        });
        if (state.history.length > 20) {
            state.history = state.history.slice(0, 20);
        }
        this.saveState(state);

        log('PROVISIONING', `Published global bundle "${type}" rev ${nextRev} (${normalized.length} items, +${summary.added} -${summary.removed} ~${summary.modified})`);
        return { revision: nextRev, checksum, count: normalized.length };
    }

    public getPublishedBundle(type: 'applications' | 'connectivity-probes', revision?: number): any[] | null {
        try {
            const state = this.getState();
            const revToLoad = revision || state.appliedRevisions[type]?.revision;
            
            if (revToLoad) {
                const revFile = path.join(this.globalDir, type, `rev-${revToLoad}.json`);
                if (fs.existsSync(revFile)) {
                    return JSON.parse(fs.readFileSync(revFile, 'utf8'));
                }
            }

            // Fallback: check manifest (Leader mode)
            const manifest = this.getManifest();
            const b = manifest.bundles.find(x => x.type === type);
            if (b) {
                const manifestRevFile = path.join(this.globalDir, type, `rev-${b.revision}.json`);
                if (fs.existsSync(manifestRevFile)) {
                    return JSON.parse(fs.readFileSync(manifestRevFile, 'utf8'));
                }
            }
        } catch (e: any) {
            log('PROVISIONING', `Failed to read published bundle ${type}: ${e.message}`, 'warn');
        }
        return null;
    }

    public hasUnpublishedChanges(type: 'applications' | 'connectivity-probes', currentActiveItems: any[]): boolean {
        const lastBundle = this.getPublishedBundle(type);
        if (!lastBundle) return currentActiveItems.length > 0;
        const currentNormalized = this.normalizeItemsWithIds(type, currentActiveItems);
        const currentChecksum = this.computeChecksum(currentNormalized);
        const publishedChecksum = this.computeChecksum(lastBundle);
        return currentChecksum !== publishedChecksum;
    }

    // ─── Local Overrides Storage ────────────────────────────────────────────────

    public getLocalOverrides(type: 'applications' | 'connectivity-probes'): { [id: string]: any } {
        try {
            const file = path.join(this.overridesDir, `${type}.json`);
            if (fs.existsSync(file)) {
                return JSON.parse(fs.readFileSync(file, 'utf8'));
            }
        } catch {}
        return {};
    }

    public saveLocalOverrides(type: 'applications' | 'connectivity-probes', overrides: { [id: string]: any }): void {
        try {
            const file = path.join(this.overridesDir, `${type}.json`);
            fs.writeFileSync(file, JSON.stringify(overrides, null, 2), 'utf8');
        } catch (e: any) {
            log('PROVISIONING', `Failed to save local overrides for ${type}: ${e.message}`, 'error');
        }
    }

    public overrideItemLocally(type: 'applications' | 'connectivity-probes', id: string, patch: Partial<any>): void {
        const overrides = this.getLocalOverrides(type);
        overrides[id] = {
            ...(overrides[id] || {}),
            ...patch,
            updatedAt: new Date().toISOString()
        };
        this.saveLocalOverrides(type, overrides);
        log('PROVISIONING', `Saved local override for ${type} item "${id}"`);
        this.reapplyEffectiveConfig(type);
    }

    public restoreGlobalValue(type: 'applications' | 'connectivity-probes', id: string): void {
        const overrides = this.getLocalOverrides(type);
        if (overrides[id]) {
            delete overrides[id];
            this.saveLocalOverrides(type, overrides);
            log('PROVISIONING', `Restored global value for ${type} item "${id}"`);
            this.reapplyEffectiveConfig(type);
        }
    }

    public computeDiff(type: 'applications' | 'connectivity-probes', oldItems: any[], newItems: any[]): { diff: SyncDiffItem[]; summary: { added: number; removed: number; modified: number } } {
        const oldMap = new Map<string, any>(oldItems.map(i => [i.id || this.generateDeterministicId(type, i), i]));
        const newMap = new Map<string, any>(newItems.map(i => [i.id || this.generateDeterministicId(type, i), i]));

        const diff: SyncDiffItem[] = [];
        let added = 0, removed = 0, modified = 0;

        for (const [id, newItem] of newMap.entries()) {
            const oldItem = oldMap.get(id);
            const displayName = newItem.name || newItem.domain || id;

            if (!oldItem) {
                added++;
                const desc = type === 'applications' ? `${newItem.domain} (weight: ${newItem.weight})` : `${newItem.type || 'PING'} ➔ ${newItem.target || ''}`;
                diff.push({ id, name: displayName, action: 'added', details: desc });
            } else {
                const changes: string[] = [];
                if (type === 'applications') {
                    if (oldItem.weight !== newItem.weight) changes.push(`weight: ${oldItem.weight} ➔ ${newItem.weight}`);
                    if (oldItem.endpoint !== newItem.endpoint) changes.push(`endpoint: ${oldItem.endpoint} ➔ ${newItem.endpoint}`);
                    if (oldItem.category !== newItem.category) changes.push(`category: ${oldItem.category} ➔ ${newItem.category}`);
                } else {
                    if (oldItem.target !== newItem.target) changes.push(`target: ${oldItem.target} ➔ ${newItem.target}`);
                    if (oldItem.timeout !== newItem.timeout) changes.push(`timeout: ${oldItem.timeout}ms ➔ ${newItem.timeout}ms`);
                    if (oldItem.frequency !== newItem.frequency) changes.push(`freq: ${oldItem.frequency}s ➔ ${newItem.frequency}s`);
                    if (oldItem.enabled !== newItem.enabled) changes.push(`enabled: ${oldItem.enabled} ➔ ${newItem.enabled}`);
                }
                if (changes.length > 0) {
                    modified++;
                    diff.push({ id, name: displayName, action: 'modified', details: changes.join(', ') });
                }
            }
        }

        for (const [id, oldItem] of oldMap.entries()) {
            if (!newMap.has(id)) {
                removed++;
                const displayName = oldItem.name || oldItem.domain || id;
                diff.push({ id, name: displayName, action: 'removed' });
            }
        }

        return { diff, summary: { added, removed, modified } };
    }

    // ─── Merge & Atomic Apply ───────────────────────────────────────────────────

    public applyGlobalBundle(type: 'applications' | 'connectivity-probes', revision: number, checksum: string, globalItems: any[]): boolean {
        const state = this.getState();
        const activeFile = type === 'applications'
            ? path.join(this.configDir, 'applications-config.json')
            : path.join(this.configDir, 'connectivity-custom.json');

        try {
            // 1. Normalize items and verify bundle integrity
            const normalizedGlobal = this.normalizeItemsWithIds(type, globalItems);
            const computedChecksum = this.computeChecksum(normalizedGlobal);
            if (computedChecksum !== checksum) {
                log('PROVISIONING', `Checksum mismatch for ${type} rev ${revision}. Expected ${checksum}, got ${computedChecksum}`, 'error');
                state.appliedRevisions[type] = {
                    revision,
                    checksum,
                    appliedAt: new Date().toISOString(),
                    status: 'failed',
                    error: 'Checksum mismatch'
                };
                this.saveState(state);
                return false;
            }

            // 2. Cache global bundle locally
            const cacheFile = path.join(this.globalDir, type, `rev-${revision}.json`);
            fs.writeFileSync(cacheFile, JSON.stringify(globalItems, null, 2), 'utf8');

            // 3. Load previous active items to calculate diff
            let oldEffective: any[] = [];
            if (fs.existsSync(activeFile)) {
                try {
                    if (type === 'applications') {
                        const raw = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
                        oldEffective = raw.applications || [];
                    } else {
                        oldEffective = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
                    }
                } catch {}
            }

            // Load local overrides & compute effective merged list
            const merged = this.buildEffectiveItems(type, globalItems);
            const { diff, summary } = this.computeDiff(type, oldEffective, merged);

            // 4. Atomic write to active flat config file
            this.atomicWriteActiveFile(type, activeFile, merged);

            // 5. Update state & history log
            const orphanIds = merged.filter((x: any) => x._source === 'orphaned').map((x: any) => x.id);
            state.appliedRevisions[type] = {
                revision,
                checksum,
                appliedAt: new Date().toISOString(),
                status: 'applied'
            };
            state.orphans[type] = orphanIds;

            if (!state.history) state.history = [];
            state.history.unshift({
                id: `${type}-rev-${revision}-${Date.now()}`,
                type,
                revision,
                timestamp: new Date().toISOString(),
                diff,
                summary
            });
            if (state.history.length > 20) {
                state.history = state.history.slice(0, 20);
            }

            this.saveState(state);

            log('PROVISIONING', `Successfully applied ${type} rev ${revision} (${merged.length} effective items, ${orphanIds.length} orphans)`);
            return true;
        } catch (e: any) {
            log('PROVISIONING', `Failed to apply ${type} rev ${revision}: ${e.message}`, 'error');
            state.appliedRevisions[type] = {
                revision,
                checksum,
                appliedAt: new Date().toISOString(),
                status: 'failed',
                error: e.message
            };
            this.saveState(state);
            return false;
        }
    }

    public reapplyEffectiveConfig(type: 'applications' | 'connectivity-probes'): void {
        const state = this.getState();
        const currentApp = state.appliedRevisions[type];
        if (!currentApp || currentApp.status !== 'applied') {
            return;
        }
        const globalItems = this.getPublishedBundle(type, currentApp.revision);
        if (!globalItems) return;

        const activeFile = type === 'applications'
            ? path.join(this.configDir, 'applications-config.json')
            : path.join(this.configDir, 'connectivity-custom.json');

        const merged = this.buildEffectiveItems(type, globalItems);
        this.atomicWriteActiveFile(type, activeFile, merged);
    }

    public buildEffectiveItems(type: 'applications' | 'connectivity-probes', globalItems: any[]): any[] {
        const normalizedGlobal = this.normalizeItemsWithIds(type, globalItems);
        const overrides = this.getLocalOverrides(type);
        const globalIdSet = new Set(normalizedGlobal.map(x => x.id));

        const effectiveList: any[] = [];

        // 1. Process Global items + apply local field overrides if present
        for (const gItem of normalizedGlobal) {
            const ov = overrides[gItem.id];
            if (ov) {
                // Allowed local override fields
                const { updatedAt, ...allowedFields } = ov;
                effectiveList.push({
                    ...gItem,
                    ...allowedFields,
                    _source: 'overridden'
                });
            } else {
                effectiveList.push({
                    ...gItem,
                    _source: 'global'
                });
            }
        }

        // 2. Process Local-only / Orphaned items
        for (const [id, ov] of Object.entries(overrides)) {
            if (!globalIdSet.has(id)) {
                if (ov._wasGlobal) {
                    effectiveList.push({
                        ...ov,
                        id,
                        _source: 'orphaned'
                    });
                } else {
                    effectiveList.push({
                        ...ov,
                        id,
                        _source: 'local'
                    });
                }
            }
        }

        return effectiveList;
    }

    private atomicWriteActiveFile(type: 'applications' | 'connectivity-probes', targetFile: string, mergedItems: any[]): void {
        // Backup existing active file
        if (fs.existsSync(targetFile)) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFile = path.join(this.backupsDir, `${type}-${timestamp}.json`);
            try { fs.copyFileSync(targetFile, backupFile); } catch {}
        }

        // Prepare raw JSON payload expected by current readers
        let payload: any;
        if (type === 'applications') {
            // applications-config.json wraps in { control: {...}, applications: [...] }
            let existingControl = { enabled: true, sleep_interval: 1.0 };
            try {
                if (fs.existsSync(targetFile)) {
                    const raw = JSON.parse(fs.readFileSync(targetFile, 'utf8'));
                    if (raw.control) existingControl = raw.control;
                }
            } catch {}

            // Clean internal _source tags before writing flat file
            const cleanApps = mergedItems.map(({ _source, _wasGlobal, ...item }) => item);
            payload = {
                control: existingControl,
                applications: cleanApps
            };
        } else {
            // connectivity-custom.json is a top-level array
            payload = mergedItems.map(({ _source, _wasGlobal, ...item }) => item);
        }

        // Write temp file -> atomic rename
        const tempFile = `${targetFile}.tmp-${Date.now()}`;
        fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), 'utf8');
        fs.renameSync(tempFile, targetFile);
    }

    public getEnrichedEffectiveItems(type: 'applications' | 'connectivity-probes', rawItems?: any[]): any[] {
        const state = this.getState();
        const currentApp = state.appliedRevisions[type];
        let globalItems: any[] = [];
        if (currentApp && currentApp.revision) {
            globalItems = this.getPublishedBundle(type, currentApp.revision) || [];
        } else {
            globalItems = this.getPublishedBundle(type) || [];
        }

        if (globalItems.length === 0) {
            if (rawItems && rawItems.length > 0) {
                globalItems = rawItems;
            } else {
                return rawItems || [];
            }
        }

        const effective = this.buildEffectiveItems(type, globalItems);
        return effective;
    }

    public handleLocalSave(type: 'applications' | 'connectivity-probes', userItems: any[]): void {
        const state = this.getState();
        if (!state.enabled) {
            return;
        }

        const currentApp = state.appliedRevisions[type];
        let globalItems: any[] = [];
        if (currentApp && currentApp.revision) {
            globalItems = this.getPublishedBundle(type, currentApp.revision) || [];
        } else {
            globalItems = this.getPublishedBundle(type) || [];
        }

        const normalizedGlobal = this.normalizeItemsWithIds(type, globalItems);
        const globalById = new Map<string, any>(normalizedGlobal.map(g => [g.id, g]));
        const overrides = this.getLocalOverrides(type);

        for (const rawItem of userItems) {
            const id = this.generateDeterministicId(type, rawItem);
            const gItem = globalById.get(id);

            if (gItem) {
                // Item originated globally — detect field-level changes
                const changes: any = {};
                let hasChanges = false;

                const checkFields = type === 'applications'
                    ? ['enabled', 'weight', 'endpoint', 'category']
                    : ['enabled', 'target', 'timeout', 'frequency', 'content_match'];

                for (const field of checkFields) {
                    if (rawItem[field] !== undefined && JSON.stringify(rawItem[field]) !== JSON.stringify(gItem[field])) {
                        changes[field] = rawItem[field];
                        hasChanges = true;
                    }
                }

                if (hasChanges) {
                    overrides[id] = {
                        ...(overrides[id] || {}),
                        ...changes,
                        _wasGlobal: true,
                        updatedAt: new Date().toISOString()
                    };
                } else {
                    // Restored back to match global completely — clean up override
                    delete overrides[id];
                }
            } else {
                // Item is local-only
                const { _source, ...cleanItem } = rawItem;
                overrides[id] = {
                    ...cleanItem,
                    id,
                    _wasGlobal: false,
                    updatedAt: new Date().toISOString()
                };
            }
        }

        this.saveLocalOverrides(type, overrides);
        this.reapplyEffectiveConfig(type);
    }
}
