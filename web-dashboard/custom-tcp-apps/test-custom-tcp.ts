/**
 * Automated Test for Custom TCP Protocol, FrameParser, CIDR, and Simulation Behaviors
 */

import { FrameParser } from './frame-parser.js';
import { encodeFrame, buildClientHello, buildRequest, buildResponse } from './protocol.js';
import { isIpInCidrs } from './cidr.js';
import { RollingRttTracker } from './metrics.js';

async function runTests() {
    console.log('🧪 Starting Custom TCP Protocol & Runtime Tests...');

    // 1. Test FrameParser with fragmented chunks
    console.log('Test 1: FrameParser stream fragmentation handling');
    const parser = new FrameParser();
    const messagesReceived: any[] = [];
    parser.on('message', msg => messagesReceived.push(msg));

    const reqMsg = buildRequest({
        requestId: 'req-test-1',
        clientSessionId: 'sess-123',
        seq: 1,
        payloadSize: 12,
        data: 'hello-stigix'
    });
    const encoded = encodeFrame(reqMsg);

    // Split into 3 arbitrary fragments
    const part1 = encoded.subarray(0, 3);
    const part2 = encoded.subarray(3, 15);
    const part3 = encoded.subarray(15);

    parser.push(part1);
    if (messagesReceived.length !== 0) throw new Error('Part 1 should not emit message yet');
    parser.push(part2);
    if (messagesReceived.length !== 0) throw new Error('Part 2 should not emit message yet');
    parser.push(part3);
    if (messagesReceived.length !== 1) throw new Error('Part 3 should complete frame and emit message');
    if (messagesReceived[0].requestId !== 'req-test-1') throw new Error('Parsed message requestId mismatch');
    console.log('  ✅ Fragmentation test passed!');

    // 2. Test FrameParser with concatenated messages in one chunk
    console.log('Test 2: FrameParser concatenated messages in single chunk');
    const msgA = buildRequest({ requestId: 'req-A', clientSessionId: 's', seq: 1, payloadSize: 4, data: 'AAAA' });
    const msgB = buildRequest({ requestId: 'req-B', clientSessionId: 's', seq: 2, payloadSize: 4, data: 'BBBB' });
    const combined = Buffer.concat([encodeFrame(msgA), encodeFrame(msgB)]);

    messagesReceived.length = 0;
    parser.push(combined);
    if (messagesReceived.length !== 2) throw new Error(`Expected 2 messages, got ${messagesReceived.length}`);
    if (messagesReceived[0].requestId !== 'req-A' || messagesReceived[1].requestId !== 'req-B') {
        throw new Error('Concatenated message order mismatch');
    }
    console.log('  ✅ Concatenation test passed!');

    // 3. Test CIDR Matching
    console.log('Test 3: CIDR Allowlist matching');
    const allowlist = ['10.0.0.0/8', '192.168.1.0/24', '172.16.50.10'];

    if (!isIpInCidrs('10.20.30.40', allowlist)) throw new Error('10.20.30.40 should match 10.0.0.0/8');
    if (!isIpInCidrs('192.168.1.55', allowlist)) throw new Error('192.168.1.55 should match 192.168.1.0/24');
    if (!isIpInCidrs('172.16.50.10', allowlist)) throw new Error('172.16.50.10 should match exact IP');
    if (isIpInCidrs('192.168.2.1', allowlist)) throw new Error('192.168.2.1 should NOT match');
    if (isIpInCidrs('8.8.8.8', allowlist)) throw new Error('8.8.8.8 should NOT match');
    if (!isIpInCidrs('8.8.8.8', [])) throw new Error('Empty allowlist should allow all');
    console.log('  ✅ CIDR allowlist tests passed!');

    // 4. Test RollingRttTracker percentiles
    console.log('Test 4: RollingRttTracker percentile calculations');
    const rttTracker = new RollingRttTracker(100);
    for (let i = 1; i <= 100; i++) {
        rttTracker.record(i * 10); // 10ms, 20ms, ... 1000ms
    }
    const stats = rttTracker.getStats();
    if (stats.min !== 10) throw new Error(`Min mismatch: ${stats.min}`);
    if (stats.max !== 1000) throw new Error(`Max mismatch: ${stats.max}`);
    if (stats.avg !== 505) throw new Error(`Avg mismatch: ${stats.avg}`);
    if (stats.p50 < 490 || stats.p50 > 520) throw new Error(`p50 mismatch: ${stats.p50}`);
    if (stats.p95 < 940 || stats.p95 > 960) throw new Error(`p95 mismatch: ${stats.p95}`);
    console.log('  ✅ RTT Percentile stats passed!');

    console.log('🎉 ALL BACKEND PROTOCOL AND RUNTIME TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
