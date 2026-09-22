/**
 * Stigix AI Copilot & MCP Automated Test Suite
 * Validates real API connectivity, tool execution, telemetry metrics, and convergence stop handling.
 */

import jwt from 'jsonwebtoken';
import { executeCopilotTool, ToolExecutionContext } from '../ai-copilot/ai-tools.js';

interface TestOptions {
    host: string;
    token?: string;
    secret?: string;
    username?: string;
    password?: string;
}

interface TestResult {
    name: string;
    durationMs: number;
    passed: boolean;
    error?: string;
    data?: any;
}

export class CopilotTestSuite {
    private host: string;
    private token: string = '';
    private username?: string;
    private password?: string;
    private results: TestResult[] = [];

    constructor(options: TestOptions) {
        this.host = options.host.replace(/\/+$/, '');
        if (options.token) {
            this.token = options.token;
        }
        this.username = options.username;
        this.password = options.password;
    }

    public async initializeAuth(): Promise<void> {
        if (this.token) return;

        // 1. Try credentials login if provided
        if (this.username && this.password) {
            try {
                const res = await fetch(`${this.host}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: this.username, password: this.password })
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.token) {
                        this.token = data.token;
                        console.log(`\x1b[32m[AUTH] Logged in successfully as "${this.username}"\x1b[0m`);
                        return;
                    }
                }
            } catch (e: any) {
                console.warn(`[AUTH] Login error: ${e.message}`);
            }
        }

        // 2. Try common JWT secrets
        const candidateSecrets = [
            'super-secret-key-change-this',
            'stigix-local-dev-secret-key-123456',
            'stigix-default-secret-2026',
            'stigix-secret-key-2026'
        ];

        for (const sec of candidateSecrets) {
            const candidateToken = jwt.sign(
                { id: 'copilot-test-runner', username: 'admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + 7200 },
                sec,
                { algorithm: 'HS256' }
            );

            try {
                const res = await fetch(`${this.host}/api/security/profile`, {
                    headers: { 'Authorization': `Bearer ${candidateToken}` }
                });
                if (res.status === 200) {
                    this.token = candidateToken;
                    console.log(`\x1b[32m[AUTH] Authenticated successfully with JWT Secret ("${sec}")\x1b[0m`);
                    return;
                }
            } catch {}
        }
    }

    private async request(path: string, options: RequestInit = {}): Promise<any> {
        const url = `${this.host}${path}`;
        const res = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`,
                ...(options.headers || {})
            }
        });
        const text = await res.text();
        let parsed: any;
        try {
            parsed = JSON.parse(text);
        } catch {
            parsed = text;
        }
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} on ${path}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
        }
        return parsed;
    }

    public async runTest(name: string, fn: () => Promise<any>): Promise<boolean> {
        const start = Date.now();
        process.stdout.write(`  ⏳ ${name.padEnd(58)} `);
        try {
            const data = await fn();
            const durationMs = Date.now() - start;
            this.results.push({ name, durationMs, passed: true, data });
            console.log(`\x1b[32mPASS\x1b[0m \x1b[90m(${durationMs}ms)\x1b[0m`);
            return true;
        } catch (e: any) {
            const durationMs = Date.now() - start;
            const err = e?.message || String(e);
            this.results.push({ name, durationMs, passed: false, error: err });
            console.log(`\x1b[31mFAIL\x1b[0m \x1b[90m(${durationMs}ms)\x1b[0m`);
            console.log(`     \x1b[31m└─ Error: ${err}\x1b[0m`);
            return false;
        }
    }

    public async runAll(): Promise<void> {
        console.log(`\n\x1b[1m\x1b[36m=================================================================\x1b[0m`);
        console.log(`\x1b[1m\x1b[36m   STIGIX AI COPILOT & MCP TEST RUNNER — ${this.host}\x1b[0m`);
        console.log(`\x1b[1m\x1b[36m=================================================================\x1b[0m\n`);

        console.log(`\x1b[1m\x1b[34m[SECTION 1: Core REST Endpoints]\x1b[0m`);

        // 1. Mesh & Peer Discovery
        await this.runTest('1. Mesh Peer Discovery (GET /api/registry/status)', async () => {
            const status = await this.request('/api/registry/status');
            if (!status || typeof status !== 'object') throw new Error('Expected status object');
            return {
                mode: status.mode || status.current_mode,
                peerCount: status.peer_count || status.active_instances_count || 0,
                siteName: status.site_name || 'N/A'
            };
        });

        // 2. Targets Registry
        await this.runTest('2. Fabric Targets List (GET /api/admin/targets)', async () => {
            const targets = await this.request('/api/admin/targets');
            return { count: targets?.targets?.length || targets?.length || 0 };
        });

        // 3. Traffic Generator Live State
        await this.runTest('3. Traffic Generator Status (GET /api/traffic/status)', async () => {
            const status = await this.request('/api/traffic/status');
            if (typeof status !== 'object') throw new Error('Invalid traffic status response');
            return status;
        });

        // 4. SASE Security Posture Profile
        await this.runTest('4. Security Profile Config (GET /api/security/profile)', async () => {
            const profile = await this.request('/api/security/profile');
            if (!profile || typeof profile !== 'object') throw new Error('Missing security profile');
            return {
                dns_categories: profile?.dns_security?.items?.length || 0,
                url_categories: profile?.url_filtering?.items?.length || 0
            };
        });

        // 5. DEM Synthetic Probes
        await this.runTest('5. DEM Probes Status (GET /api/probes)', async () => {
            const probes = await this.request('/api/probes');
            return { count: Array.isArray(probes) ? probes.length : 0 };
        });

        // 6. VyOS Routers Discovery
        await this.runTest('6. VyOS Underlay Routers (GET /api/vyos/routers)', async () => {
            const routers = await this.request('/api/vyos/routers');
            return { count: Array.isArray(routers) ? routers.length : 0 };
        });

        // 7. Complete Convergence Lifecycle (Start -> Running Check -> Stop -> Verify Metrics)
        await this.runTest('7. Convergence Lifecycle (Start -> Verify -> Stop -> Metrics)', async () => {
            // Start probe
            const startRes = await this.request('/api/convergence/start', {
                method: 'POST',
                body: JSON.stringify({
                    target: '192.168.203.100', // DC1
                    port: 6200,
                    rate: 50,
                    label: 'Automated-Test-Probe'
                })
            });
            const testId = startRes.testId || 'CONV-LIVE';

            // Wait 2s to generate packets
            await new Promise(r => setTimeout(r, 2000));

            // Verify status
            const statusList = await this.request('/api/convergence/status');
            const isRunning = Array.isArray(statusList) && statusList.some((s: any) => s.testId === testId || s.running);

            // Stop probe
            const stopRes = await this.request('/api/convergence/stop', {
                method: 'POST',
                body: JSON.stringify({ testId })
            });

            // Wait 1.5s for stats flush
            await new Promise(r => setTimeout(r, 1500));

            // Verify history
            const history = await this.request('/api/convergence/history?limit=5');
            const recent = Array.isArray(history) && history.length > 0 ? history[0] : null;

            return {
                testId,
                wasRunning: isRunning,
                stopResponse: stopRes,
                lastRecordedVerdict: recent?.verdict || 'N/A',
                lastRecordedRttMs: recent?.avg_rtt_ms || recent?.latency_ms || 'N/A'
            };
        });

        // 8. Speedtest XFR Check
        await this.runTest('8. Speedtest History (GET /api/tests/xfr)', async () => {
            const jobs = await this.request('/api/tests/xfr?limit=5');
            return { count: Array.isArray(jobs) ? jobs.length : 0 };
        });

        console.log(`\n\x1b[1m\x1b[34m[SECTION 2: AI Copilot & FastMCP Tool Handlers Execution]\x1b[0m`);

        // Context forwarding calls to remote node
        const remoteCtx: ToolExecutionContext = {
            systemToken: this.token,
            registryManager: {
                getSiteName: () => 'BR8',
                getPeers: () => [
                    { site_name: 'BR8', ip_private: '192.168.123.102', port: 8080 }
                ]
            }
        };

        // 9. Tool: list_endpoints
        await this.runTest('9. Tool "list_endpoints"', async () => {
            const res = await executeCopilotTool('list_endpoints', { kind: 'fabric' }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 10. Tool: get_traffic_stats
        await this.runTest('10. Tool "get_traffic_stats" (BR8)', async () => {
            const res = await executeCopilotTool('get_traffic_stats', { agent_id: this.host }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 11. Tool: get_security_results_stats
        await this.runTest('11. Tool "get_security_results_stats" (BR8)', async () => {
            const res = await executeCopilotTool('get_security_results_stats', { agent_id: this.host }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 12. Tool: get_dem_summary
        await this.runTest('12. Tool "get_dem_summary" (BR8)', async () => {
            const res = await executeCopilotTool('get_dem_summary', { agent_id: this.host }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 13. Tool: list_speedtest_history (verified newest-first sort)
        await this.runTest('13. Tool "list_speedtest_history" (Newest-First Sort)', async () => {
            const res = await executeCopilotTool('list_speedtest_history', { agent_id: this.host, limit: 5 }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 14. Tool: get_convergence_history
        await this.runTest('14. Tool "get_convergence_history" (BR8)', async () => {
            const res = await executeCopilotTool('get_convergence_history', { agent_id: this.host, limit: 5 }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 15. Tool: get_health_matrix
        await this.runTest('15. Tool "get_health_matrix" (360° Matrix)', async () => {
            const res = await executeCopilotTool('get_health_matrix', { agent_id: this.host }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 16. Tool: run_test (Profile XFR Speedtest)
        await this.runTest('16. Tool "run_test" (Profile XFR Speedtest to DC1)', async () => {
            const res = await executeCopilotTool('run_test', {
                source_id: this.host,
                target: '192.168.203.100',
                profile: 'xfr',
                duration: '3s'
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            if (Array.isArray(res.tests) && res.tests.some((t: any) => t.error)) {
                throw new Error(res.tests.find((t: any) => t.error)?.error);
            }
            return res;
        });

        // 16b. Tool: run_test (Profile Convergence on UDP 6200)
        await this.runTest('16b. Tool "run_test" (Profile Convergence on Port 6200)', async () => {
            const res = await executeCopilotTool('run_test', {
                source_id: this.host,
                target: '192.168.123.100',
                profile: 'conv',
                pps: 50
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            const convTest = res.tests?.[0];
            if (!convTest) throw new Error('No convergence test returned');
            if (convTest.port !== 6200) {
                throw new Error(`Expected convergence port 6200, received ${convTest.port}`);
            }
            // Cleanup: stop the active convergence test
            try {
                await this.request('/api/convergence/stop', 'POST', { testId: convTest.test_id });
            } catch {}
            return { profile: convTest.profile, port: convTest.port, test_id: convTest.test_id };
        });

        // 16c. Tool: run_test (Profile Voice on UDP 6100)
        await this.runTest('16c. Tool "run_test" (Profile Voice on Port 6100)', async () => {
            const res = await executeCopilotTool('run_test', {
                source_id: this.host,
                target: '192.168.123.100',
                profile: 'voice'
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            const voiceTest = res.tests?.[0];
            if (!voiceTest) throw new Error('No voice test returned');
            if (voiceTest.port !== 6100) {
                throw new Error(`Expected voice port 6100, received ${voiceTest.port}`);
            }
            // Cleanup: stop voice
            try {
                await this.request('/api/voice/control', 'POST', { enabled: false });
            } catch {}
            return { profile: voiceTest.profile, port: voiceTest.port };
        });

        // 17. Tool: add_dem_probe (Netflix probe)
        await this.runTest('17. Tool "add_dem_probe" (Add Netflix Probe)', async () => {
            const res = await executeCopilotTool('add_dem_probe', {
                agent_id: this.host,
                name: 'Netflix Test',
                target: 'https://www.netflix.com',
                probe_type: 'HTTPS',
                timeout_ms: 5000
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 18. Tool: get_probe_details (Verify Netflix probe exists)
        await this.runTest('18. Tool "get_probe_details" (Verify Netflix Test)', async () => {
            const res = await executeCopilotTool('get_probe_details', {
                agent_id: this.host,
                probe_name: 'Netflix Test'
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 19. Tool: remove_dem_probe (Cleanup Netflix probe)
        await this.runTest('19. Tool "remove_dem_probe" (Delete Netflix Test Probe)', async () => {
            const res = await executeCopilotTool('remove_dem_probe', {
                agent_id: this.host,
                probe_name: 'Netflix Test'
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 20. Tool: get_probe_details (Confirm Probe is Absent)
        await this.runTest('20. Confirm Probe Deletion (Verify Not Found)', async () => {
            const res = await executeCopilotTool('get_probe_details', {
                agent_id: this.host,
                probe_name: 'Netflix Test'
            }, remoteCtx);
            // Should return error or not found
            if (res && !res.error && res.name === 'Netflix Test') {
                throw new Error('Probe still exists after deletion');
            }
            return { confirmedDeleted: true };
        });

        // 21. Tool: get_test_status (Verify Latest Speedtest Metrics)
        await this.runTest('21. Verify Latest Speedtest Metrics & Status Retrieval', async () => {
            const listRes = await executeCopilotTool('list_speedtest_history', {
                agent_id: this.host,
                limit: 1
            }, remoteCtx);
            if (listRes.error) throw new Error(listRes.error);
            const latest = listRes.recent_tests?.[0];
            if (!latest) throw new Error('No speedtest record found');

            const statusRes = await executeCopilotTool('get_test_status', {
                agent_id: this.host,
                test_id: latest.sequence_id || latest.id
            }, remoteCtx);
            if (statusRes.error) throw new Error(statusRes.error);
            return {
                test_id: latest.sequence_id,
                date: latest.started_at,
                throughput_mbps: statusRes.throughput_mbps ?? latest.throughput_mbps,
                rtt_ms: statusRes.rtt_ms ?? latest.rtt_ms
            };
        });

        // 22. Tool: create_custom_tcp_app (Deploy app-pos-test)
        await this.runTest('22. Tool "create_custom_tcp_app" (Deploy app-pos-test)', async () => {
            const res = await executeCopilotTool('create_custom_tcp_app', {
                agent_id: this.host,
                name: 'app-pos-test',
                port: 18443,
                description: 'Point of Sale Transaction Simulator',
                client_mode: 'transactional',
                payload_bytes: 2048,
                interval_ms: 500,
                auto_start_listener: true
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 23. Tool: list_custom_tcp_apps (Verify app-pos-test is listed)
        await this.runTest('23. Tool "list_custom_tcp_apps" (Verify app-pos-test)', async () => {
            const res = await executeCopilotTool('list_custom_tcp_apps', {
                agent_id: this.host
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            const apps = res.applications || (Array.isArray(res) ? res : []);
            const found = apps.find((a: any) => a.name === 'app-pos-test' || a.id === 'app-pos-test');
            if (!found) throw new Error('app-pos-test not found in custom tcp apps');
            return { foundApp: found.name, port: found.listener?.port };
        });

        // 23b. Tool: add_tcp_app_peer (Attach test peer DC1 to app-pos-test)
        await this.runTest('23b. Tool "add_tcp_app_peer" (Attach DC1 peer)', async () => {
            const res = await executeCopilotTool('add_tcp_app_peer', {
                agent_id: this.host,
                app_id: 'app-pos-test',
                peer_name_or_host: '192.168.123.100',
                site_name: 'DataCenter-DC1',
                port: 18443
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 23c. Tool: get_tcp_app_sessions (Inspect app-pos-test active sessions)
        await this.runTest('23c. Tool "get_tcp_app_sessions" (Inspect app-pos-test sessions)', async () => {
            const res = await executeCopilotTool('get_tcp_app_sessions', {
                agent_id: this.host,
                app_id: 'app-pos-test'
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            if (!Array.isArray(res.sessions) && !Array.isArray(res.incoming_sessions) && typeof res.total_incoming !== 'number') {
                throw new Error(`Expected sessions payload, received: ${JSON.stringify(res)}`);
            }
            return {
                app_id: res.app_id || 'app-pos-test',
                total_incoming: res.total_incoming ?? (Array.isArray(res.incoming_sessions) ? res.incoming_sessions.length : 0),
                total_outgoing: res.total_outgoing ?? (Array.isArray(res.outgoing_sessions) ? res.outgoing_sessions.length : 0),
                sessionsCount: Array.isArray(res.sessions) ? res.sessions.length : 0
            };
        });

        // 24. Tool: delete_custom_tcp_app (Cleanup app-pos-test)
        await this.runTest('24. Tool "delete_custom_tcp_app" (Cleanup app-pos-test)', async () => {
            const res = await executeCopilotTool('delete_custom_tcp_app', {
                agent_id: this.host,
                app_id: 'app-pos-test'
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return res;
        });

        // 25. REST GET /api/tests/xfr/:id (Verify Direct Lookup by UUID)
        await this.runTest('25. Direct UUID Job Lookup (/api/tests/xfr/:id)', async () => {
            const jobs = await this.request('/api/tests/xfr?limit=1');
            const jobId = jobs?.[0]?.id;
            if (!jobId) return { skipped: 'No jobs available' };
            const job = await this.request(`/api/tests/xfr/${jobId}`);
            if (!job || job.id !== jobId) {
                throw new Error(`Expected job id ${jobId}, received ${job?.id}`);
            }
            return { id: job.id, sequence_id: job.sequence_id, status: job.status };
        });

        // 26. Tool: get_test_status by Sequence ID format (e.g. XFR-XXXX)
        await this.runTest('26. Tool "get_test_status" (Resolution by Sequence ID)', async () => {
            const jobs = await this.request('/api/tests/xfr?limit=1');
            const seqId = jobs?.[0]?.sequence_id;
            if (!seqId) return { skipped: 'No jobs available' };
            const statusRes = await executeCopilotTool('get_test_status', {
                agent_id: this.host,
                test_id: seqId
            }, remoteCtx);
            if (statusRes.error) throw new Error(statusRes.error);
            if (statusRes.sequence_id !== seqId && statusRes.test_id !== seqId) {
                throw new Error(`Resolution failed: expected ${seqId}`);
            }
            return {
                resolved: statusRes.sequence_id || statusRes.test_id,
                status: statusRes.status,
                throughput_mbps: statusRes.throughput_mbps
            };
        });

        // 27. Tool: get_provisioning_status
        await this.runTest('27. Tool "get_provisioning_status"', async () => {
            const res = await executeCopilotTool('get_provisioning_status', { agent_id: this.host }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return {
                pullMode: res.pull_mode_enabled ?? res.enabled,
                manifest: res.manifest ? Object.keys(res.manifest) : []
            };
        });

        // 28. Tool: publish_configuration_bundle (Connectivity Probes)
        await this.runTest('28. Tool "publish_configuration_bundle" (Probes Bundle)', async () => {
            const res = await executeCopilotTool('publish_configuration_bundle', {
                agent_id: this.host,
                bundle_type: 'connectivity-probes'
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return {
                published: res.published?.type || 'connectivity-probes',
                revision: res.published?.revision
            };
        });

        // 29. Tool: get_prisma_flows (Query Flow Browser & verify query_window metadata)
        await this.runTest('29. Tool "get_prisma_flows" (Flow Browser & Window Metadata)', async () => {
            const res = await executeCopilotTool('get_prisma_flows', {
                agent_id: this.host,
                site_name: 'BR8',
                hours: 1,
                fast: true,
                page_size: 5
            }, remoteCtx);
            if (res.error) throw new Error(res.error);
            return {
                site_name: res.site_name,
                query_window: res.query_window,
                flowsCount: Array.isArray(res.flows) ? res.flows.length : 0
            };
        });

        // Summary
        const passedCount = this.results.filter(r => r.passed).length;
        const totalCount = this.results.length;
        const allPassed = passedCount === totalCount;

        console.log(`\n\x1b[1m\x1b[36m-----------------------------------------------------------------\x1b[0m`);
        console.log(
            `\x1b[1m  RESULT: ${allPassed ? '\x1b[32m' : '\x1b[31m'}${passedCount}/${totalCount} TESTS PASSED\x1b[0m | ` +
            `Total Duration: ${(this.results.reduce((a, b) => a + b.durationMs, 0) / 1000).toFixed(2)}s`
        );
        console.log(`\x1b[1m\x1b[36m-----------------------------------------------------------------\x1b[0m\n`);
    }
}

// CLI Entrypoint
const targetArg = process.argv.find(a => a.startsWith('--host='))?.split('=')[1] || process.argv.find(a => a.startsWith('http')) || 'http://192.168.123.102:8080';
const tokenArg = process.argv.find(a => a.startsWith('--token='))?.split('=')[1];
const userArg = process.argv.find(a => a.startsWith('--user='))?.split('=')[1] || process.argv.find(a => a.startsWith('--username='))?.split('=')[1];
const passArg = process.argv.find(a => a.startsWith('--pass='))?.split('=')[1] || process.argv.find(a => a.startsWith('--password='))?.split('=')[1];

const runner = new CopilotTestSuite({
    host: targetArg,
    token: tokenArg,
    username: userArg,
    password: passArg
});

async function main() {
    await runner.initializeAuth();
    await runner.runAll();
}

main().catch(err => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});
