/**
 * Unit Test Suite for Stigix ChangeGuard Snapshot & Delta Engine
 */

import { SnapshotManager, StigixSnapshot } from '../snapshot-manager.js';
import { executeCopilotTool, COPILOT_TOOLS } from '../ai-copilot/ai-tools.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function runTests() {
    console.log('🧪 Starting Stigix ChangeGuard Snapshot & Delta Test Suite...\n');

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stigix-test-snapshots-'));
    const manager = new SnapshotManager(tempDir);

    try {
        // 1. Verify Tool Definitions in COPILOT_TOOLS
        const hasTakeSnapshot = COPILOT_TOOLS.some(t => t.name === 'take_snapshot');
        const hasCompareSnapshots = COPILOT_TOOLS.some(t => t.name === 'compare_snapshots');
        const hasListSnapshots = COPILOT_TOOLS.some(t => t.name === 'list_snapshots');

        if (!hasTakeSnapshot || !hasCompareSnapshots || !hasListSnapshots) {
            throw new Error(`Missing snapshot tool definitions in COPILOT_TOOLS (take=${hasTakeSnapshot}, compare=${hasCompareSnapshots}, list=${hasListSnapshots})`);
        }
        console.log('✓ COPILOT_TOOLS contains take_snapshot, compare_snapshots, list_snapshots');

        // 2. Mock context for state capture
        const mockContext = {
            registryManager: {
                getStatus: () => ({ instance_id: 'br1-node-01', current_mode: 'peer', detected_ip: '198.51.100.22' }),
                getSiteName: () => 'BR1',
                getPeers: () => [
                    { instance_id: 'dc1-hub', site_name: 'DC1', status: 'ONLINE', ip_private: '10.200.0.1' },
                    { instance_id: 'br2-spoke', site_name: 'BR2', status: 'ONLINE', ip_private: '10.200.0.3' }
                ]
            },
            connectivityLogger: {
                getStats: async () => ({ globalHealth: 98 }),
                getResults: async () => [
                    { endpointId: 'probe-dc1-icmp', name: 'probe-dc1-icmp', latency: 24.5, jitter: 1.2, packet_loss: 0.0, mos: 4.38, success: true },
                    { endpointId: 'probe-saas-m365', name: 'probe-saas-m365', latency: 15.0, jitter: 0.8, packet_loss: 0.0, mos: 4.41, success: true }
                ]
            },
            getAllProbes: () => [
                { name: 'probe-dc1-icmp', type: 'PING', target: '10.200.0.1', enabled: true },
                { name: 'probe-saas-m365', type: 'HTTP', target: 'https://login.microsoftonline.com', enabled: true }
            ]
        };

        // 3. Test captureState (Baseline)
        const baseline = await manager.captureState({
            name: 'pre-fiber-cutover',
            description: 'Baseline state before ISP migration',
            tags: ['migration', 'isp'],
            createdBy: 'test-runner',
            context: mockContext
        });

        console.log(`✓ Baseline snapshot captured: "${baseline.name}" (ID: ${baseline.id})`);
        if (baseline.tunnels.length !== 2 || baseline.demMatrix.length !== 2) {
            throw new Error(`Unexpected tunnel/probe counts: tunnels=${baseline.tunnels.length}, probes=${baseline.demMatrix.length}`);
        }

        // 4. Test listSnapshots and getSnapshot
        const list = manager.listSnapshots();
        if (list.length !== 1 || list[0].id !== baseline.id) {
            throw new Error(`listSnapshots failed, expected 1 item with id ${baseline.id}, got ${list.length}`);
        }
        console.log(`✓ listSnapshots verified (1 snapshot found)`);

        const fetched = manager.getSnapshot('pre-fiber-cutover');
        if (!fetched || fetched.id !== baseline.id) {
            throw new Error('getSnapshot by name failed');
        }
        console.log(`✓ getSnapshot by name resolved correctly`);

        // 5. Test Delta Engine Scenario A: Successful migration (Improved latency, all tunnels UP)
        const postMigrationState: StigixSnapshot = JSON.parse(JSON.stringify(baseline));
        postMigrationState.id = 'snap-post-migration';
        postMigrationState.name = 'post-fiber-cutover';
        postMigrationState.timestamp = new Date(Date.now() + 3600000).toISOString();
        // Improve DC1 latency: 24.5ms -> 11.2ms (-54%)
        postMigrationState.demMatrix[0].latencyAvgMs = 11.2;
        await manager.saveSnapshot(postMigrationState);

        const diffSuccess = manager.computeDiff(baseline, postMigrationState);
        console.log(`✓ Diff Computed (Scenario A - Success): Verdict = ${diffSuccess.summary.verdict}, Score = ${diffSuccess.summary.score}`);
        if (diffSuccess.summary.verdict !== 'GO') {
            throw new Error(`Expected GO verdict, got ${diffSuccess.summary.verdict}`);
        }
        if (diffSuccess.improvements.length === 0) {
            throw new Error('Expected latency improvement alert');
        }
        console.log(`  Improvements: ${diffSuccess.improvements.join(' | ')}`);

        // 6. Test Delta Engine Scenario B: Degraded migration (Tunnel down + packet loss)
        const postDegradedState: StigixSnapshot = JSON.parse(JSON.stringify(baseline));
        postDegradedState.id = 'snap-post-degraded';
        postDegradedState.name = 'post-cutover-failure';
        // Tunnel to BR2 went DOWN
        postDegradedState.tunnels[1].status = 'DOWN';
        // DC1 probe suffered packet loss
        postDegradedState.demMatrix[0].packetLossPercent = 5.0;
        await manager.saveSnapshot(postDegradedState);

        const diffDegraded = manager.computeDiff(baseline, postDegradedState);
        console.log(`✓ Diff Computed (Scenario B - Failure): Verdict = ${diffDegraded.summary.verdict}, Score = ${diffDegraded.summary.score}`);
        if (diffDegraded.summary.verdict !== 'NO_GO') {
            throw new Error(`Expected NO_GO verdict due to failed tunnel, got ${diffDegraded.summary.verdict}`);
        }
        if (diffDegraded.regressions.length === 0) {
            throw new Error('Expected regression alerts');
        }
        console.log(`  Regressions detected: ${diffDegraded.regressions.join(' | ')}`);

        // 7. Test executeCopilotTool integration
        const toolCtx = {
            snapshotManager: manager,
            ...mockContext
        };

        const listToolRes = await executeCopilotTool('list_snapshots', {}, toolCtx);
        if (!listToolRes.snapshots || listToolRes.snapshots.length < 3) {
            throw new Error('executeCopilotTool list_snapshots failed');
        }
        console.log(`✓ executeCopilotTool('list_snapshots') returned ${listToolRes.snapshots.length} snapshots`);

        const compareToolRes = await executeCopilotTool('compare_snapshots', {
            baseline: 'pre-fiber-cutover',
            target: 'post-cutover-failure'
        }, toolCtx);

        if (compareToolRes.summary?.verdict !== 'NO_GO') {
            throw new Error(`executeCopilotTool compare_snapshots failed to flag NO_GO`);
        }
        console.log(`✓ executeCopilotTool('compare_snapshots') correctly evaluated regression: Verdict = ${compareToolRes.summary.verdict}`);

        // 8. Test deleteSnapshot
        const deleted = manager.deleteSnapshot('post-cutover-failure');
        if (!deleted || manager.getSnapshot('post-cutover-failure') !== null) {
            throw new Error('deleteSnapshot failed');
        }
        console.log('✓ deleteSnapshot verified');

        console.log('\n🎉 ALL CHANGEGUARD SNAPSHOT & DELTA TESTS PASSED SUCCESSFULLY!');
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

runTests().catch(err => {
    console.error('\n❌ Test suite failed:', err);
    process.exit(1);
});
