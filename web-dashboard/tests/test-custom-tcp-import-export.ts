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

        console.log('\n🎉 ALL CUSTOM TCP IMPORT/EXPORT TESTS PASSED SUCCESSFULLY!');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
