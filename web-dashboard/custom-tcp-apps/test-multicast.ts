/**
 * Automated Verification Suite for Stigix SD-WAN Overlay Multicast Engine
 * Tests:
 * 1. ASM/SSM & Link-Local Validation Rules
 * 2. 24-Byte STGX Binary Header Packing & Unpacking (!IQQHH)
 * 3. Live UDP/IGMP Loopback Stream (Sender -> Receiver, 0% Loss, Jitter, Join Latency)
 * 4. Late-Join Sequence Baseline (joining mid-stream without false-positive loss)
 * 5. Negative Policy Leak Detection (expect: 'none' -> FAILED when traffic arrives)
 * 6. Pre-Flight Check Inspection
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { validateMulticastApplicationConfig } from './validation.js';
import { MulticastSenderRuntime, MulticastReceiverRuntime } from './multicast-runtime.js';
import { CustomTcpConfigStore } from './config-store.js';
import { MulticastAppManager } from './multicast-manager.js';

async function runMulticastTests() {
    console.log('🧪 Starting SD-WAN Overlay Multicast Engine Tests...');

    // 1. Validation tests
    console.log('Test 1: ASM / SSM / Link-Local Validation Rules');
    const validAsm = validateMulticastApplicationConfig({
        id: 'mc-test-1',
        name: 'ASM Feed',
        multicast: {
            group: '239.1.1.100',
            port: 5001,
            mode: 'ASM',
            ttl: 8,
            dscp: 'EF',
            profile: 'cbr',
            bitrateKbps: 500,
            packetSizeBytes: 1200
        },
        sender: { nodeId: 'DC1' }
    }, []);
    if (!validAsm.valid) throw new Error(`Valid ASM failed: ${validAsm.errors.join(', ')}`);

    const invalidLinkLocal = validateMulticastApplicationConfig({
        id: 'mc-test-2',
        name: 'Link Local Bad',
        multicast: {
            group: '224.0.0.5',
            port: 5001,
            mode: 'ASM',
            ttl: 8,
            dscp: 'EF',
            profile: 'cbr',
            bitrateKbps: 500,
            packetSizeBytes: 1200
        },
        sender: { nodeId: 'DC1' }
    }, []);
    if (invalidLinkLocal.valid) throw new Error('224.0.0.5 link-local should be rejected');

    const invalidSsmNoSource = validateMulticastApplicationConfig({
        id: 'mc-test-3',
        name: 'SSM Missing Source',
        multicast: {
            group: '232.1.1.10',
            port: 5001,
            mode: 'SSM',
            ssmSource: null,
            ttl: 8,
            dscp: 'EF',
            profile: 'cbr',
            bitrateKbps: 500,
            packetSizeBytes: 1200
        },
        sender: { nodeId: 'DC1' }
    }, []);
    if (invalidSsmNoSource.valid) throw new Error('SSM without ssmSource should be rejected');
    console.log('  ✅ Validation rules passed!');

    // 2. 24-Byte STGX Binary Header Packing & Unpacking
    console.log('Test 2: 24-Byte STGX Binary Header (!IQQHH)');
    const buf = Buffer.alloc(1200);
    const tsNs = BigInt(Date.now()) * 1_000_000n;
    MulticastSenderRuntime.packHeader(buf, 42n, tsNs, 12345, 7);
    const parsed = MulticastReceiverRuntime.unpackHeader(buf);
    if (!parsed) throw new Error('Failed to unpack valid STGX header');
    if (parsed.sequenceId !== 42n) throw new Error(`Sequence mismatch: ${parsed.sequenceId}`);
    if (parsed.timestampNs !== tsNs) throw new Error(`Timestamp mismatch: ${parsed.timestampNs}`);
    if (parsed.streamId !== 12345) throw new Error(`StreamId mismatch: ${parsed.streamId}`);
    if (parsed.runId !== 7) throw new Error(`RunId mismatch: ${parsed.runId}`);
    console.log('  ✅ 24-byte STGX header packing/unpacking passed!');

    // 3. Live Loopback Multicast Stream & Late-Join Verification
    console.log('Test 3: Live UDP/IGMP Multicast Loopback Stream + Late Join Baseline');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stigix-mc-test-'));
    try {
        const store = new CustomTcpConfigStore(tmpDir);
        await store.load('DC1');
        const manager = new MulticastAppManager(store);

        const savedApp = await manager.saveApplication({
            id: 'mc-loopback-test',
            name: 'Loopback Multicast Test',
            multicast: {
                group: '239.255.77.88',
                port: 15501,
                mode: 'ASM',
                ttl: 2,
                dscp: 'EF',
                profile: 'cbr',
                bitrateKbps: 512,
                packetSizeBytes: 512
            },
            sender: {
                nodeId: 'DC1',
                interfaceIp: '127.0.0.1'
            },
            receivers: [
                {
                    nodeId: 'DC1',
                    interfaceIp: '127.0.0.1',
                    enabled: true,
                    expect: 'receive'
                }
            ],
            thresholds: {
                maxLossPct: 1.0,
                maxJitterMs: 50.0,
                maxGapMs: 500
            }
        });

        // Pre-flight check before starting
        const preflight = await manager.runClusterPreflight(savedApp.id);
        if (!preflight.nodes['DC1']) throw new Error('Missing DC1 preflight node result');
        console.log(`  ✅ Pre-flight check passed on DC1 (iface: ${preflight.nodes['DC1'].interfaceName} / ${preflight.nodes['DC1'].interfaceIp})`);

        // Start cluster stream
        await manager.startClusterStream(savedApp.id);
        await new Promise(r => setTimeout(r, 450));

        const status1 = await manager.getClusterStats(savedApp.id);
        const rcv1 = status1.receivers[0];
        if (!status1.sender?.active || status1.sender.packetsSent < 5) {
            throw new Error(`Sender did not transmit enough packets: ${status1.sender?.packetsSent}`);
        }
        if (!rcv1 || rcv1.packetsReceived < 5) {
            throw new Error(`Receiver did not receive packets: ${rcv1?.packetsReceived} (sender=${JSON.stringify(status1.sender)}, rcv=${JSON.stringify(rcv1)})`);
        }
        if (rcv1.verdict !== 'HEALTHY') {
            throw new Error(`Expected HEALTHY verdict, got ${rcv1.verdict} (${rcv1.verdictReason})`);
        }
        console.log(`  ✅ Initial stream healthy: Sent=${status1.sender.packetsSent}, Rx=${rcv1.packetsReceived}, Loss=${rcv1.lossPct}%, Jitter=${rcv1.jitterMs}ms`);

        // Test Scenario S4: Late Join mid-stream (leave then re-join after more packets are sent)
        await manager.toggleClusterReceiver(savedApp.id, 'DC1', 'leave');
        await new Promise(r => setTimeout(r, 250));
        await manager.toggleClusterReceiver(savedApp.id, 'DC1', 'join', 'receive');
        await new Promise(r => setTimeout(r, 350));

        const statusLate = await manager.getClusterStats(savedApp.id);
        const rcvLate = statusLate.receivers[0];
        if (!rcvLate || (rcvLate.firstSeq || 0) <= 1) {
            throw new Error(`Late join receiver should have firstSeq > 1, got ${rcvLate?.firstSeq}`);
        }
        if (rcvLate.packetsLost !== 0) {
            throw new Error(`Late join receiver should have 0 false-positive packet loss, got ${rcvLate.packetsLost}`);
        }
        console.log(`  ✅ Late-Join baseline verified: firstSeq=${rcvLate.firstSeq}, packetsReceived=${rcvLate.packetsReceived}, packetsLost=${rcvLate.packetsLost}`);

        // Test Scenario S6: Negative policy leak detection (expect: 'none' receiving packets -> FAILED)
        await manager.toggleClusterReceiver(savedApp.id, 'DC1', 'join', 'none');
        await new Promise(r => setTimeout(r, 250));
        const statusLeak = await manager.getClusterStats(savedApp.id);
        const rcvLeak = statusLeak.receivers[0];
        if (rcvLeak.verdict !== 'FAILED') {
            throw new Error(`Expected FAILED verdict on expect='none' leak, got ${rcvLeak.verdict}`);
        }
        console.log(`  ✅ Policy leak detection (expect='none') verified: Verdict=${rcvLeak.verdict} (${rcvLeak.verdictReason})`);

        await manager.stopClusterStream(savedApp.id);
        await manager.stopAll();
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    console.log('🎉 ALL SD-WAN OVERLAY MULTICAST ENGINE TESTS PASSED SUCCESSFULLY!');
}

runMulticastTests().catch(err => {
    console.error('❌ Multicast test failed:', err);
    process.exit(1);
});
