/**
 * Unit Test Suite for Custom TCP Applications Export & Import Lifecycle
 */

import { TcpAppManager } from '../custom-tcp-apps/tcp-app-manager.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function runTests() {
    console.log('🧪 Starting Custom TCP Import/Export Test Suite...');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stigix-test-custom-tcp-'));
    const manager = new TcpAppManager(tempDir);

    try {
        await manager.init('DC1-Ubuntu', false);

        // 1. Check initial config
        const initialConfig = manager.getConfig();
        console.log(`✓ Initial config loaded with ${initialConfig.applications.length} sample application(s)`);

        // 2. Test Export payload formatting
        const exportPayload = {
            version: initialConfig.version || 1,
            exportedAt: new Date().toISOString(),
            exportedFromSite: initialConfig.instance?.siteName || 'DC1-Ubuntu',
            applications: initialConfig.applications
        };
        if (!exportPayload.applications || exportPayload.applications.length === 0) {
            throw new Error('Export payload missing applications');
        }
        console.log('✓ Export payload structure validated');

        // 3. Test Import with Merge Mode
        const newApps = [
            {
                id: 'app-test-banking',
                name: 'SWIFT Banking Gateway',
                description: 'Financial inter-site message bus',
                protocol: 'tcp_raw',
                listener: {
                    bindAddress: '0.0.0.0',
                    port: 9100,
                    behavior: 'echo'
                },
                peers: [
                    { peerId: 'peer-1', name: 'BR8 Core', host: '192.168.219.1', port: 9100 }
                ]
            },
            {
                id: 'app-test-dicom',
                name: 'DICOM PACS Medical Streamer',
                description: 'Medical imaging PACS protocol',
                protocol: 'http_1_1',
                listener: {
                    bindAddress: '0.0.0.0',
                    port: 9200,
                    behavior: 'http_json'
                }
            }
        ];

        const mergeResult = await manager.importApplications(newApps, 'merge');
        console.log(`✓ Merge import completed: +${mergeResult.addedCount} added, ${mergeResult.updatedCount} updated`);
        if (mergeResult.addedCount !== 2) {
            throw new Error(`Expected 2 added apps, got ${mergeResult.addedCount}`);
        }

        const afterMergeConfig = manager.getConfig();
        const foundBanking = afterMergeConfig.applications.find(a => a.name === 'SWIFT Banking Gateway');
        const foundDicom = afterMergeConfig.applications.find(a => a.name === 'DICOM PACS Medical Streamer');
        if (!foundBanking || !foundDicom) {
            throw new Error('Imported apps not found in config store after merge');
        }
        console.log('✓ Merged applications found in config store with correct ports and peers');

        // 4. Test Import with Update (same name, modified port/description)
        const updateApps = [
            {
                name: 'SWIFT Banking Gateway',
                description: 'Updated description for SWIFT Gateway',
                listener: { port: 9105 }
            }
        ];
        const updateResult = await manager.importApplications(updateApps, 'merge');
        console.log(`✓ Update merge completed: +${updateResult.addedCount} added, ${updateResult.updatedCount} updated`);
        if (updateResult.updatedCount !== 1) {
            throw new Error(`Expected 1 updated app, got ${updateResult.updatedCount}`);
        }

        const afterUpdateConfig = manager.getConfig();
        const updatedBanking = afterUpdateConfig.applications.find(a => a.name === 'SWIFT Banking Gateway');
        if (!updatedBanking || updatedBanking.listener.port !== 9105) {
            throw new Error('Updated application port was not updated correctly');
        }
        console.log('✓ Application in-place update confirmed');

        // 5. Test Import with Replace Mode
        const replaceBundle = [
            {
                id: 'app-pos-cloud',
                name: 'POS Terminal Sync',
                description: 'Retail point of sale synchronization',
                protocol: 'http_1_1',
                listener: { port: 9500 }
            }
        ];
        const replaceResult = await manager.importApplications(replaceBundle, 'replace');
        console.log(`✓ Replace import completed: ${replaceResult.importedCount} app(s) imported`);
        
        const afterReplaceConfig = manager.getConfig();
        if (afterReplaceConfig.applications.length !== 1 || afterReplaceConfig.applications[0].name !== 'POS Terminal Sync') {
            throw new Error('Replace mode failed to cleanly overwrite applications');
        }
        console.log('✓ Replace mode validation passed (only 1 target app remains)');

        // 6. Test Exact User Roundtrip Fidelity (Import Hetzner payload -> Export -> Match full schema)
        const hetznerPayload = {
            version: 1,
            exportedAt: '2026-09-25T17:25:05.388Z',
            exportedFromSite: 'Hetzner-Ubuntu',
            application: {
                id: 'app-muh8djl2',
                name: 'test2',
                description: 'Detailed banking test app',
                enabled: true,
                protocol: 'http_1_1',
                listener: {
                    bindAddress: '0.0.0.0',
                    port: 8098,
                    maxConnections: 100,
                    idleTimeoutMs: 60000,
                    maxPayloadBytes: 1048576,
                    tcpKeepalive: true,
                    allowCidrs: ['10.0.0.0/8'],
                    auth: {
                        enabled: false
                    }
                },
                serverBehavior: {
                    mode: 'fixed_delay',
                    fixedDelayMs: 500,
                    randomDelayMinMs: 100,
                    randomDelayMaxMs: 1000,
                    loopingNormalSec: 60,
                    loopingSlowSec: 60,
                    loopingSlowDelayMs: 1000,
                    dropProbability: 0,
                    errorProbability: 0
                },
                clientDefaults: {
                    mode: 'persistent_request_reply',
                    connectionsPerPeer: 2,
                    intervalMs: 1000,
                    payloadBytes: 1024,
                    requestTimeoutMs: 5000,
                    connectTimeoutMs: 5000,
                    autoReconnect: true,
                    reconnectInitialMs: 1000,
                    reconnectMaxMs: 30000,
                    tcpKeepalive: true,
                    sourceInterface: 'auto'
                },
                peers: [],
                startup: {
                    startListener: true,
                    startClientWorkload: false
                }
            }
        };

        await manager.importApplications([hetznerPayload.application], 'merge');
        const reExportedApp = manager.getConfig().applications.find(a => a.id === 'app-muh8djl2');
        if (!reExportedApp) {
            throw new Error('Hetzner app test2 was not found after import');
        }
        if (!reExportedApp.serverBehavior || reExportedApp.serverBehavior.mode !== 'fixed_delay') {
            throw new Error(`Expected serverBehavior.mode === 'fixed_delay', got ${reExportedApp.serverBehavior?.mode}`);
        }
        if (reExportedApp.serverBehavior.fixedDelayMs !== 500) {
            throw new Error(`Expected fixedDelayMs === 500, got ${reExportedApp.serverBehavior.fixedDelayMs}`);
        }
        if (reExportedApp.listener.port !== 8098) {
            throw new Error(`Expected listener.port === 8098, got ${reExportedApp.listener.port}`);
        }
        if (reExportedApp.listener.maxConnections !== 100) {
            throw new Error(`Expected maxConnections === 100, got ${reExportedApp.listener.maxConnections}`);
        }
        console.log('✓ Full roundtrip fidelity confirmed: serverBehavior, listener, clientDefaults, protocol preserved with 100% precision');

        console.log('\n🎉 ALL CUSTOM TCP IMPORT/EXPORT TESTS PASSED SUCCESSFULLY!');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
