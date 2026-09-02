/**
 * Stigix Custom TCP Inter-Site Applications — History Logger (JSONL)
 */

import fs from 'fs';
import path from 'path';
import { RunHistoryRecord } from './types.js';

export class CustomTcpHistoryStore {
    private readonly filePath: string;
    private readonly maxRecords: number;

    constructor(configDir: string, maxRecords: number = 2000) {
        this.filePath = path.join(configDir, 'custom-tcp-app-history.jsonl');
        this.maxRecords = maxRecords;
    }

    public async appendRecord(record: RunHistoryRecord): Promise<void> {
        try {
            const line = JSON.stringify(record) + '\n';
            await fs.promises.appendFile(this.filePath, line, 'utf8');
        } catch (err) {
            console.error('[CUSTOM_TCP_HISTORY] Failed to append history record:', err);
        }
    }

    public async getRecords(appId?: string, limit: number = 50): Promise<RunHistoryRecord[]> {
        if (!fs.existsSync(this.filePath)) {
            return [];
        }

        try {
            const content = await fs.promises.readFile(this.filePath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);
            const records: RunHistoryRecord[] = [];

            for (let i = lines.length - 1; i >= 0; i--) {
                try {
                    const parsed = JSON.parse(lines[i]) as RunHistoryRecord;
                    if (!appId || parsed.appId === appId) {
                        records.push(parsed);
                        if (records.length >= limit) break;
                    }
                } catch {
                    // Skip corrupt line
                }
            }

            return records;
        } catch (err) {
            console.error('[CUSTOM_TCP_HISTORY] Failed to read history records:', err);
            return [];
        }
    }

    public async rotateIfNeeded(): Promise<void> {
        if (!fs.existsSync(this.filePath)) return;

        try {
            const content = await fs.promises.readFile(this.filePath, 'utf8');
            const lines = content.split('\n').filter(l => l.trim().length > 0);
            if (lines.length > this.maxRecords) {
                const retained = lines.slice(lines.length - Math.floor(this.maxRecords * 0.75));
                await fs.promises.writeFile(this.filePath, retained.join('\n') + '\n', 'utf8');
            }
        } catch (err) {
            console.error('[CUSTOM_TCP_HISTORY] Failed to rotate history:', err);
        }
    }
}
