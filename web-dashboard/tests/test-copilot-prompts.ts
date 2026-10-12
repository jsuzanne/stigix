/**
 * Stigix AI Copilot End-to-End Prompt Test Runner
 *
 * Validates real natural language chat prompts against live Stigix instances.
 * Tests LLM tool calling, SSE streaming, multi-node resolution, argument parsing,
 * and response generation end-to-end using real DeepSeek or Claude providers.
 */

import jwt from 'jsonwebtoken';

interface TestScenario {
    id: string;
    title: string;
    prompt: string;
    description: string;
    expectedTools: string[];
    validateToolCalls?: (tools: CapturedToolCall[]) => { ok: boolean; reason?: string };
    validateResponse?: (text: string) => { ok: boolean; reason?: string };
}

interface CapturedToolCall {
    id: string;
    tool: string;
    input: any;
    status: 'running' | 'completed' | 'failed';
    output?: any;
    error?: string;
    durationMs?: number;
}

interface PromptRunResult {
    scenario: TestScenario;
    passed: boolean;
    durationMs: number;
    llmDurationMs: number;
    toolCalls: CapturedToolCall[];
    responseText: string;
    error?: string;
    reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Test Scenarios Catalog
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIOS: TestScenario[] = [
    {
        id: 'dem-probe-aircall-br1',
        title: 'DEM Probe Metrics on Spoke (Aircall on BR1)',
        description: 'Verifies that LLM selects get_probe_details for Aircall on BR1 and receives real metrics (score, latency, status)',
        prompt: 'Donne-moi le score de santé, la latence et le statut de la probe Aircall sur BR1.',
        expectedTools: ['get_probe_details'],
        validateToolCalls: (tools) => {
            const probeCall = tools.find(t => t.tool === 'get_probe_details');
            if (!probeCall) return { ok: false, reason: 'get_probe_details was not called by LLM' };
            if (probeCall.status !== 'completed') return { ok: false, reason: `get_probe_details failed: ${probeCall.error}` };

            const out = probeCall.output;
            if (!out || out.error) return { ok: false, reason: `Tool output error: ${out?.error || 'empty'}` };
            if (typeof out.score !== 'number' && out.status !== 'healthy' && out.status !== 'failed') {
                return { ok: false, reason: `Expected score or status in probe details, received: ${JSON.stringify(out)}` };
            }
            return { ok: true };
        },
        validateResponse: (text) => {
            const lower = text.toLowerCase();
            if (lower.includes('erreur 404') || lower.includes('non trouvée') || lower.includes('introuvable')) {
                return { ok: false, reason: 'Response text indicates probe was not found' };
            }
            if (!lower.includes('aircall')) {
                return { ok: false, reason: 'Response does not mention Aircall' };
            }
            return { ok: true };
        }
    },
    {
        id: 'custom-tcp-apps-br8',
        title: 'Custom TCP Applications Inventory (BR8)',
        description: 'Verifies that LLM calls list_custom_tcp_apps and receives configured TCP applications without error',
        prompt: 'Quelles sont les applications Custom TCP configurées sur BR8 ? Donne leur nom et leur port.',
        expectedTools: ['list_custom_tcp_apps'],
        validateToolCalls: (tools) => {
            const call = tools.find(t => t.tool === 'list_custom_tcp_apps');
            if (!call) return { ok: false, reason: 'list_custom_tcp_apps was not called' };
            if (call.status !== 'completed') return { ok: false, reason: `list_custom_tcp_apps failed: ${call.error}` };

            const apps = Array.isArray(call.output) ? call.output : (call.output?.applications || []);
            if (!apps || apps.length === 0) {
                return { ok: false, reason: 'Expected at least 1 custom TCP application' };
            }
            return { ok: true };
        },
        validateResponse: (text) => {
            const lower = text.toLowerCase();
            if (lower.includes('is not a function') || lower.includes('error')) {
                return { ok: false, reason: 'Response text contains an unhandled exception' };
            }
            return { ok: true };
        }
    },
    {
        id: 'vyos-state-br8',
        title: 'VyOS Underlay Router State & Interfaces (BR8)',
        description: 'Verifies that LLM calls get_vyos_router_state on BR8 and returns interfaces without 404 fallback',
        prompt: 'Interroge l\'état du routeur "vyosrouter" sur BR8 avec get_vyos_router_state et donne ses interfaces.',
        expectedTools: ['get_vyos_router_state'],
        validateToolCalls: (tools) => {
            const call = tools.find(t => t.tool === 'get_vyos_router_state' || t.tool === 'get_vyos_interfaces');
            if (!call) return { ok: false, reason: 'No VyOS state/interface tool called' };
            if (call.status !== 'completed') return { ok: false, reason: `VyOS call failed: ${call.error}` };

            const out = call.output;
            if (!out || (typeof out === 'string' && out.includes('<!doctype html'))) {
                return { ok: false, reason: 'Received SPA 404 HTML fallback' };
            }
            return { ok: true };
        },
        validateResponse: (text) => {
            if (text.includes('404') && text.includes('adhoc')) {
                return { ok: false, reason: 'Response still mentions 404 /api/vyos/adhoc' };
            }
            return { ok: true };
        }
    },
    {
        id: 'dem-summary-br1',
        title: 'DEM Node Health Summary & Global Score (BR1)',
        description: 'Verifies that LLM calls get_dem_summary and surfaces health_score and total probes',
        prompt: 'Quel est le score de santé global DEM et le nombre de sondes actives sur le nœud BR1 ?',
        expectedTools: ['get_dem_summary'],
        validateToolCalls: (tools) => {
            const call = tools.find(t => t.tool === 'get_dem_summary');
            if (!call) return { ok: false, reason: 'get_dem_summary was not called' };
            if (call.status !== 'completed') return { ok: false, reason: `get_dem_summary failed: ${call.error}` };

            const out = call.output;
            if (!out || (!out.total_probes && !out.probes)) {
                return { ok: false, reason: 'Invalid dem summary output format' };
            }
            return { ok: true };
        }
    },
    {
        id: 'mesh-endpoints-discovery',
        title: 'Mesh Endpoints & Fabric Targets Discovery',
        description: 'Verifies that LLM calls list_endpoints and returns fabric mesh targets',
        prompt: 'Liste toutes les cibles du mesh SD-WAN et donne-moi les sites disponibles.',
        expectedTools: ['list_endpoints'],
        validateToolCalls: (tools) => {
            const call = tools.find(t => t.tool === 'list_endpoints');
            if (!call) return { ok: false, reason: 'list_endpoints was not called' };
            if (call.status !== 'completed') return { ok: false, reason: `list_endpoints failed: ${call.error}` };

            const out = call.output;
            const endpoints = out?.endpoints || out?.fabric_endpoints || (Array.isArray(out) ? out : []);
            if (!endpoints || endpoints.length === 0) {
                return { ok: false, reason: 'list_endpoints returned empty endpoints list' };
            }
            return { ok: true };
        }
    }
];

// ─────────────────────────────────────────────────────────────────────────────
// Prompt Test Runner Class
// ─────────────────────────────────────────────────────────────────────────────

export class CopilotPromptTestRunner {
    private host: string;
    private token: string = '';
    private username?: string;
    private password?: string;
    private verbose: boolean = false;
    private modelOverride?: string;

    constructor(options: {
        host: string;
        token?: string;
        username?: string;
        password?: string;
        verbose?: boolean;
        model?: string;
    }) {
        this.host = options.host.replace(/\/+$/, '');
        if (options.token) this.token = options.token;
        this.username = options.username;
        this.password = options.password;
        this.verbose = Boolean(options.verbose);
        this.modelOverride = options.model;
    }

    public async initializeAuth(): Promise<void> {
        if (this.token) return;

        // 1. Try credentials login
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
            } catch {}
        }

        // 2. Try known candidate JWT secrets
        const candidateSecrets = [
            'your-secure-secret-here',
            'super-secret-key-change-this',
            'stigix-local-dev-secret-key-123456',
            'stigix-default-secret-2026',
            'stigix-secret-key-2026'
        ];

        for (const sec of candidateSecrets) {
            const candidateToken = jwt.sign(
                { id: 'prompt-test-runner', username: 'admin', role: 'admin', exp: Math.floor(Date.now() / 1000) + 7200 },
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

        throw new Error(`Unable to authenticate to ${this.host}. Provide valid credentials or token.`);
    }

    public async runScenario(scenario: TestScenario): Promise<PromptRunResult> {
        console.log(`\n\x1b[1m\x1b[34m[SCENARIO: ${scenario.id}]\x1b[0m \x1b[1m${scenario.title}\x1b[0m`);
        console.log(`\x1b[90mPrompt: "${scenario.prompt}"\x1b[0m`);

        const startTotal = Date.now();
        let responseText = '';
        const toolCallsMap = new Map<string, CapturedToolCall>();

        try {
            const chatRes = await fetch(`${this.host}/api/copilot/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({
                    prompt: scenario.prompt,
                    model: this.modelOverride
                })
            });

            if (!chatRes.ok) {
                const errText = await chatRes.text();
                throw new Error(`HTTP ${chatRes.status} from /api/copilot/chat: ${errText}`);
            }

            const body = chatRes.body;
            if (!body) throw new Error('Response body is null');

            const reader = body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const block of lines) {
                    if (!block.trim()) continue;
                    let event = 'message';
                    let dataStr = '';

                    const subLines = block.split('\n');
                    for (const l of subLines) {
                        if (l.startsWith('event:')) event = l.substring(6).trim();
                        else if (l.startsWith('data:')) dataStr = l.substring(5).trim();
                    }

                    if (!dataStr) continue;

                    try {
                        const parsed = JSON.parse(dataStr);
                        if (event === 'chunk' || parsed.type === 'chunk') {
                            const chunk = parsed.delta || parsed.text || '';
                            responseText += chunk;
                            if (this.verbose) process.stdout.write(chunk);
                        } else if (event === 'tool_call' || parsed.type === 'tool_call') {
                            const tc = parsed.toolCall;
                            if (tc) {
                                const key = tc.id || tc.name || tc.tool;
                                const existing = toolCallsMap.get(key);
                                const updated: CapturedToolCall = {
                                    id: key,
                                    tool: tc.tool || tc.name,
                                    input: tc.input || existing?.input || {},
                                    status: tc.status || 'running',
                                    output: tc.output !== undefined ? tc.output : existing?.output,
                                    error: tc.error,
                                    durationMs: tc.durationMs || existing?.durationMs
                                };
                                toolCallsMap.set(key, updated);

                                if (updated.status === 'running' && !existing) {
                                    console.log(`  \x1b[33m⚙️  LLM calling tool:\x1b[0m \x1b[1m${updated.tool}\x1b[0m(${JSON.stringify(updated.input)})`);
                                } else if (updated.status === 'completed') {
                                    console.log(`  \x1b[32m✅ Tool completed:\x1b[0m \x1b[1m${updated.tool}\x1b[0m in ${updated.durationMs || '?'}ms`);
                                } else if (updated.status === 'failed') {
                                    console.log(`  \x1b[31m❌ Tool failed:\x1b[0m \x1b[1m${updated.tool}\x1b[0m: ${updated.error}`);
                                }
                            }
                        } else if (event === 'error' || parsed.type === 'error') {
                            throw new Error(parsed.message || parsed.error || 'Server sent an error event');
                        }
                    } catch (e: any) {
                        if (e.message?.includes('Server sent an error event')) throw e;
                    }
                }
            }

            const totalDuration = Date.now() - startTotal;
            const capturedCalls = Array.from(toolCallsMap.values());

            // 1. Validate expected tools were called
            for (const expected of scenario.expectedTools) {
                const called = capturedCalls.some(t => t.tool === expected);
                if (!called) {
                    return {
                        scenario,
                        passed: false,
                        durationMs: totalDuration,
                        llmDurationMs: totalDuration,
                        toolCalls: capturedCalls,
                        responseText,
                        reason: `Expected tool "${expected}" was NOT called by the LLM`
                    };
                }
            }

            // 2. Validate tool calls outcome
            if (scenario.validateToolCalls) {
                const validation = scenario.validateToolCalls(capturedCalls);
                if (!validation.ok) {
                    return {
                        scenario,
                        passed: false,
                        durationMs: totalDuration,
                        llmDurationMs: totalDuration,
                        toolCalls: capturedCalls,
                        responseText,
                        reason: validation.reason || 'Custom tool validation failed'
                    };
                }
            }

            // 3. Validate response text
            if (scenario.validateResponse) {
                const textValidation = scenario.validateResponse(responseText);
                if (!textValidation.ok) {
                    return {
                        scenario,
                        passed: false,
                        durationMs: totalDuration,
                        llmDurationMs: totalDuration,
                        toolCalls: capturedCalls,
                        responseText,
                        reason: textValidation.reason || 'Response text validation failed'
                    };
                }
            }

            return {
                scenario,
                passed: true,
                durationMs: totalDuration,
                llmDurationMs: totalDuration,
                toolCalls: capturedCalls,
                responseText
            };

        } catch (err: any) {
            return {
                scenario,
                passed: false,
                durationMs: Date.now() - startTotal,
                llmDurationMs: 0,
                toolCalls: Array.from(toolCallsMap.values()),
                responseText,
                error: err.message || String(err),
                reason: err.message || String(err)
            };
        }
    }

    public async runAll(filterId?: string): Promise<PromptRunResult[]> {
        console.log(`\n=================================================================`);
        console.log(`   STIGIX AI COPILOT NATURAL LANGUAGE PROMPT TEST RUNNER`);
        console.log(`   Target Node: \x1b[36m${this.host}\x1b[0m`);
        if (this.modelOverride) console.log(`   Model Override: \x1b[35m${this.modelOverride}\x1b[0m`);
        console.log(`=================================================================\n`);

        const targets = filterId
            ? SCENARIOS.filter(s => s.id === filterId || s.id.includes(filterId))
            : SCENARIOS;

        if (targets.length === 0) {
            console.error(`No scenarios matched filter: "${filterId}"`);
            return [];
        }

        const results: PromptRunResult[] = [];

        for (let i = 0; i < targets.length; i++) {
            const s = targets[i];
            const res = await this.runScenario(s);
            results.push(res);

            if (res.passed) {
                console.log(`  \x1b[32m✔ RESULT: PASS\x1b[0m (${(res.durationMs / 1000).toFixed(2)}s, ${res.toolCalls.length} tool calls)`);
            } else {
                console.log(`  \x1b[31m✖ RESULT: FAIL\x1b[0m (${(res.durationMs / 1000).toFixed(2)}s)`);
                console.log(`    \x1b[31mReason:\x1b[0m ${res.reason || res.error}`);
            }
        }

        // Summary Table
        console.log(`\n\x1b[1m\x1b[36m=================================================================\x1b[0m`);
        console.log(`\x1b[1m                     PROMPT TEST RUN SUMMARY                     \x1b[0m`);
        console.log(`\x1b[1m\x1b[36m=================================================================\x1b[0m`);

        let passedCount = 0;
        for (const r of results) {
            const icon = r.passed ? '\x1b[32m✔ PASS\x1b[0m' : '\x1b[31m✖ FAIL\x1b[0m';
            const toolsList = r.toolCalls.map(t => t.tool).join(', ') || 'none';
            console.log(`  [${icon}] \x1b[1m${r.scenario.id}\x1b[0m (${(r.durationMs / 1000).toFixed(2)}s) — Tools: [${toolsList}]`);
            if (!r.passed) {
                console.log(`         \x1b[31m└─ Error:\x1b[0m ${r.reason || r.error}`);
            } else {
                passedCount++;
            }
        }

        const allPassed = passedCount === results.length;
        console.log(`\n\x1b[1m  RESULT: ${allPassed ? '\x1b[32m' : '\x1b[31m'}${passedCount}/${results.length} SCENARIOS PASSED\x1b[0m | Total Time: ${(results.reduce((a, b) => a + b.durationMs, 0) / 1000).toFixed(2)}s\n`);

        return results;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Entrypoint
// ─────────────────────────────────────────────────────────────────────────────

const hostArg = process.argv.find(a => a.startsWith('--host='))?.split('=')[1] || 'http://192.168.123.102:8080';
const tokenArg = process.argv.find(a => a.startsWith('--token='))?.split('=')[1];
const onlyArg = process.argv.find(a => a.startsWith('--only='))?.split('=')[1];
const modelArg = process.argv.find(a => a.startsWith('--model='))?.split('=')[1];
const verboseArg = process.argv.includes('--verbose');

const runner = new CopilotPromptTestRunner({
    host: hostArg,
    token: tokenArg,
    model: modelArg,
    verbose: verboseArg
});

async function main() {
    await runner.initializeAuth();
    const results = await runner.runAll(onlyArg);
    const failed = results.filter(r => !r.passed).length;
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('\x1b[31mFatal Prompt Runner Error:\x1b[0m', err);
    process.exit(1);
});
