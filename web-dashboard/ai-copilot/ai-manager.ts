/**
 * Stigix In-App AI Copilot — Core AI Manager
 * Multi-Provider BYOK Engine: Anthropic Messages API & DeepSeek API (V3 / R1)
 * Handles BYOK key storage, tool dispatching, and streaming SSE responses.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
    AiConfig,
    AiPublicConfig,
    AiProvider,
    ApiCallTrace,
    CopilotSession,
    CopilotMessage,
    CopilotToolCall
} from './types.js';
import { COPILOT_TOOLS, executeCopilotTool, ToolExecutionContext } from './ai-tools.js';

export const AVAILABLE_MODELS = [
    // Anthropic Claude
    { id: 'claude-sonnet-4-5-20250929', provider: 'anthropic' as AiProvider, name: 'Claude Sonnet 4.5 (Recommended)', description: 'Best balance of intelligence, speed, and tool calling precision' },
    { id: 'claude-haiku-4-5-20251001', provider: 'anthropic' as AiProvider, name: 'Claude Haiku 4.5 (Fast)', description: 'Ultra-fast response time for rapid diagnostics' },
    { id: 'claude-sonnet-4-6', provider: 'anthropic' as AiProvider, name: 'Claude Sonnet 4.6', description: 'Next-gen Sonnet reasoning engine' },
    { id: 'claude-sonnet-5', provider: 'anthropic' as AiProvider, name: 'Claude Sonnet 5 (Latest)', description: 'Flagship frontier intelligence for complex network orchestration' },
    { id: 'claude-opus-4-5-20251101', provider: 'anthropic' as AiProvider, name: 'Claude Opus 4.5', description: 'High-capability model for complex multi-step diagnostics' },
    // DeepSeek
    { id: 'deepseek-chat', provider: 'deepseek' as AiProvider, name: 'DeepSeek-V3 (Chat)', description: 'High performance general LLM with full tool calling support' },
    { id: 'deepseek-reasoner', provider: 'deepseek' as AiProvider, name: 'DeepSeek-R1 (Reasoner)', description: 'Reasoning model with chain-of-thought and deep diagnostics' }
];

export function normalizeModelId(modelId?: string): string {
    if (!modelId) return 'claude-sonnet-4-5-20250929';
    if (modelId === 'deepseek-chat' || modelId === 'deepseek-reasoner') {
        return modelId;
    }
    if (modelId.includes('3-5-sonnet') || modelId.includes('3-7-sonnet')) {
        return 'claude-sonnet-4-5-20250929';
    }
    if (modelId.includes('3-5-haiku')) {
        return 'claude-haiku-4-5-20251001';
    }
    if (modelId.includes('3-opus')) {
        return 'claude-opus-4-5-20251101';
    }
    return modelId;
}

export class AiManager {
    private configPath: string;
    private sessionsPath: string;
    private config: AiConfig;
    private sessions: Map<string, CopilotSession> = new Map();
    private projectRoot: string;
    private executionContext: ToolExecutionContext = {};

    constructor(configDirOrProjectRoot: string) {
        this.projectRoot = configDirOrProjectRoot;
        // Support both APP_CONFIG.configDir (direct persistent config folder) or project root
        const isAlreadyConfigDir = path.basename(configDirOrProjectRoot) === 'config' || 
            fs.existsSync(path.join(configDirOrProjectRoot, 'targets.json')) || 
            fs.existsSync(path.join(configDirOrProjectRoot, 'ui-config.json'));
        
        const configDir = isAlreadyConfigDir ? configDirOrProjectRoot : path.join(configDirOrProjectRoot, 'config');
        if (!fs.existsSync(configDir)) {
            try { fs.mkdirSync(configDir, { recursive: true }); } catch {}
        }
        this.configPath = path.join(configDir, 'ai-config.json');
        this.sessionsPath = path.join(configDir, 'ai-sessions.json');

        this.config = this.loadConfig();
        this.loadSessions();
    }

    public setExecutionContext(ctx: ToolExecutionContext): void {
        this.executionContext = ctx;
    }

    private loadConfig(): AiConfig {
        const envAnthropicKey = process.env.ANTHROPIC_API_KEY || '';
        const envDeepseekKey = process.env.DEEPSEEK_API_KEY || '';
        const defaultProvider: AiProvider = (envDeepseekKey && !envAnthropicKey) ? 'deepseek' : 'anthropic';

        const defaultCfg: AiConfig = {
            enabled: true,
            provider: defaultProvider,
            apiKey: envAnthropicKey,
            deepseekApiKey: envDeepseekKey,
            defaultModel: defaultProvider === 'deepseek' ? 'deepseek-chat' : 'claude-sonnet-4-5-20250929',
            requireConfirmation: true,
            maxTokensPerRequest: 8192
        };

        if (fs.existsSync(this.configPath)) {
            try {
                const saved = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                return {
                    ...defaultCfg,
                    ...saved,
                    apiKey: saved.apiKey || envAnthropicKey,
                    deepseekApiKey: saved.deepseekApiKey || envDeepseekKey,
                    provider: saved.provider || (saved.deepseekApiKey && !saved.apiKey ? 'deepseek' : defaultCfg.provider),
                    defaultModel: normalizeModelId(saved.defaultModel || defaultCfg.defaultModel)
                };
            } catch {}
        }
        return defaultCfg;
    }

    public saveConfig(patch: Partial<AiConfig>): AiPublicConfig {
        const updated: AiConfig = {
            ...this.config,
            ...patch
        };

        // Auto-detect provider if apiKey is supplied without explicit provider
        if (patch.apiKey && !patch.provider) {
            if (patch.apiKey.startsWith('sk-ant-')) {
                updated.provider = 'anthropic';
            } else if (patch.apiKey.startsWith('sk-')) {
                updated.provider = 'deepseek';
                updated.deepseekApiKey = patch.apiKey;
            }
        }

        if (patch.deepseekApiKey) {
            updated.deepseekApiKey = patch.deepseekApiKey;
            if (!patch.provider && !patch.apiKey) {
                updated.provider = 'deepseek';
            }
        }

        if (patch.defaultModel) {
            updated.defaultModel = normalizeModelId(patch.defaultModel);
            if (updated.defaultModel.startsWith('deepseek-') && !patch.provider) {
                updated.provider = 'deepseek';
            } else if (updated.defaultModel.startsWith('claude-') && !patch.provider) {
                updated.provider = 'anthropic';
            }
        }

        if (patch.systemPromptCustom !== undefined) {
            updated.systemPromptCustom = String(patch.systemPromptCustom || '').trim();
        }

        this.config = updated;

        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
            try { fs.chmodSync(this.configPath, 0o600); } catch {}
        } catch (e: any) {
            console.error('[AI-MANAGER] Failed to persist ai-config.json:', e.message);
        }
        return this.getPublicConfig();
    }

    public getPublicConfig(): AiPublicConfig {
        const anthropicKey = (this.config.apiKey || '').trim();
        const deepseekKey = (this.config.deepseekApiKey || '').trim();

        const maskKey = (key: string) => {
            if (key.length > 10) {
                return `${key.substring(0, 8)}••••••••••••${key.substring(key.length - 4)}`;
            } else if (key.length > 0) {
                return '••••••••••••';
            }
            return '';
        };

        const envVal = (
            process.env.ENABLE_AI_COPILOT ||
            process.env.STIGIX_ENABLE_AI_COPILOT ||
            process.env.STIGIX_AI_COPILOT_ENABLED ||
            process.env.ENABLE_COPILOT ||
            process.env.COPILOT_ENABLED ||
            ''
        ).toLowerCase().trim();

        const featureEnabled = envVal === 'true' || envVal === '1' || envVal === 'yes' || envVal === 'on';
        const hasAnthropic = Boolean(anthropicKey && anthropicKey.length > 5);
        const hasDeepseek = Boolean(deepseekKey && deepseekKey.length > 5);

        return {
            enabled: this.config.enabled !== false,
            featureEnabled,
            provider: this.config.provider || (hasDeepseek && !hasAnthropic ? 'deepseek' : 'anthropic'),
            hasKey: hasAnthropic || hasDeepseek,
            maskedKey: maskKey(anthropicKey),
            keyMasked: maskKey(anthropicKey),
            hasDeepseekKey: hasDeepseek,
            maskedDeepseekKey: maskKey(deepseekKey),
            defaultModel: normalizeModelId(this.config.defaultModel),
            requireConfirmation: this.config.requireConfirmation !== false,
            systemPromptCustom: this.config.systemPromptCustom || '',
            models: AVAILABLE_MODELS
        };
    }

    private loadSessions(): void {
        if (fs.existsSync(this.sessionsPath)) {
            try {
                const raw = JSON.parse(fs.readFileSync(this.sessionsPath, 'utf8'));
                if (Array.isArray(raw)) {
                    raw.forEach(s => this.sessions.set(s.id, s));
                }
            } catch {}
        }
    }

    private persistSessions(): void {
        try {
            const arr = Array.from(this.sessions.values());
            fs.writeFileSync(this.sessionsPath, JSON.stringify(arr, null, 2), 'utf8');
        } catch {}
    }

    public getSessionsList(): Array<Omit<CopilotSession, 'messages'>> {
        return Array.from(this.sessions.values())
            .map(s => ({
                id: s.id,
                title: s.title || 'New Conversation',
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
                model: s.model
            }))
            .sort((a, b) => b.updatedAt - a.updatedAt);
    }

    public getSession(id: string): CopilotSession | null {
        return this.sessions.get(id) || null;
    }

    public createSession(model?: string): CopilotSession {
        const session: CopilotSession = {
            id: `sess-${crypto.randomUUID().substring(0, 8)}`,
            title: 'New Conversation',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            model: normalizeModelId(model || this.config.defaultModel),
            messages: []
        };
        this.sessions.set(session.id, session);
        this.persistSessions();
        return session;
    }

    public deleteSession(id: string): boolean {
        const deleted = this.sessions.delete(id);
        if (deleted) this.persistSessions();
        return deleted;
    }

    public clearAllSessions(): void {
        this.sessions.clear();
        this.persistSessions();
    }

    /**
     * Validates an API Key against Anthropic or DeepSeek.
     */
    public async testApiKey(
        apiKey: string,
        providerHint?: 'anthropic' | 'deepseek'
    ): Promise<{ valid: boolean; provider?: 'anthropic' | 'deepseek'; error?: string; models?: string[] }> {
        const key = (apiKey || '').trim();
        if (!key) {
            return { valid: false, error: 'API key is required' };
        }

        const isAnthropic = providerHint === 'anthropic' || key.startsWith('sk-ant-');

        if (isAnthropic) {
            try {
                const modelsRes = await fetch('https://api.anthropic.com/v1/models', {
                    method: 'GET',
                    headers: {
                        'x-api-key': key,
                        'anthropic-version': '2023-06-01'
                    }
                });

                if (modelsRes.ok) {
                    const modelsData: any = await modelsRes.json().catch(() => ({}));
                    const availableModels = (modelsData?.data || []).map((m: any) => m.id);
                    return { valid: true, provider: 'anthropic', models: availableModels };
                }

                if (modelsRes.status === 401) {
                    return { valid: false, provider: 'anthropic', error: 'Authentication failed: Invalid Anthropic API key.' };
                }
                if (modelsRes.status === 403) {
                    const errData: any = await modelsRes.json().catch(() => ({}));
                    return { valid: false, provider: 'anthropic', error: errData?.error?.message || 'Access forbidden: Check Anthropic permissions.' };
                }
            } catch (e: any) {
                console.log('[COPILOT_TEST_KEY] Anthropic models endpoint error:', e);
            }

            // Fallback ping test
            try {
                const res = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                        'x-api-key': key,
                        'anthropic-version': '2023-06-01',
                        'content-type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'claude-haiku-4-5-20251001',
                        max_tokens: 10,
                        messages: [{ role: 'user', content: 'Ping' }]
                    })
                });

                if (res.ok) {
                    return { valid: true, provider: 'anthropic' };
                }

                const errData = await res.json().catch(() => ({}));
                return { valid: false, provider: 'anthropic', error: errData?.error?.message || `HTTP ${res.status}: Anthropic validation error` };
            } catch (e: any) {
                return { valid: false, provider: 'anthropic', error: `Anthropic connection failed: ${e?.message || e}` };
            }
        } else {
            // DeepSeek validation
            try {
                const modelsRes = await fetch('https://api.deepseek.com/models', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${key}`
                    }
                });

                if (modelsRes.ok) {
                    const data: any = await modelsRes.json().catch(() => ({}));
                    const availableModels = (data?.data || []).map((m: any) => m.id);
                    return {
                        valid: true,
                        provider: 'deepseek',
                        models: availableModels.length ? availableModels : ['deepseek-chat', 'deepseek-reasoner']
                    };
                }

                if (modelsRes.status === 401) {
                    return { valid: false, provider: 'deepseek', error: 'Authentication failed: Invalid DeepSeek API key.' };
                }
                if (modelsRes.status === 402) {
                    return { valid: false, provider: 'deepseek', error: 'DeepSeek account has insufficient balance / credits.' };
                }
            } catch (e: any) {
                console.log('[COPILOT_TEST_KEY] DeepSeek /models fetch error:', e);
            }

            // Fallback: ping deepseek-chat completions
            try {
                const compRes = await fetch('https://api.deepseek.com/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${key}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        max_tokens: 5,
                        messages: [{ role: 'user', content: 'ping' }]
                    })
                });

                if (compRes.ok) {
                    return { valid: true, provider: 'deepseek', models: ['deepseek-chat', 'deepseek-reasoner'] };
                }

                const errData = await compRes.json().catch(() => ({}));
                return { valid: false, provider: 'deepseek', error: errData?.error?.message || `HTTP ${compRes.status}: DeepSeek validation failed` };
            } catch (e: any) {
                return { valid: false, provider: 'deepseek', error: `DeepSeek connection failed: ${e?.message || e}` };
            }
        }
    }

    /**
     * Builds contextual system prompt with live Stigix node data.
     */
    private buildSystemPrompt(): string {
        const siteName = this.executionContext.registryManager?.getSiteName() || 'LOCAL';
        const peersCount = this.executionContext.registryManager?.getPeers()?.length || 0;
        const role = this.executionContext.registryManager?.getStatus()?.mode || 'Peer Node';

        let prompt = `You are Stigix AI Copilot, an expert AI assistant embedded inside the Stigix SD-WAN and SASE Validation Platform.

CURRENT LAB CONTEXT:
- Local Stigix Node: ${siteName} (${role})
- Connected Mesh Peers: ${peersCount} active remote peers
- Platform Capabilities: SaaS Traffic Generation, Real-Time APM/RUM, Digital Experience (DEM) Probes, SASE Security Testing (URL, DNS, C2, AI Security), Voice RTP Simulation, Custom TCP East-West Apps, VyOS Router Control, and Convergence Lab.
- VyOS Router Control (CENTRALIZED UNDERLAY): Underlay VyOS routers ("vyosrouter", "vyoslandc1", "vyoslandc2new") are centrally managed on THIS controller node (${siteName}) and emulate WAN circuits for ALL lab sites (interface descriptions indicate the site/circuit, e.g. "BR1-INET-227", "BR1-MPLS-197", "BR2-INET-226", "BR2-MPLS-196", "DC1-INET-221", "DC1-MPLS-191", "DC2-INET-222", "ALL-INET-220", "ALL-MPLS-190"). Remote branches like BR1, BR2, or BR5 do NOT host their own local VyOS config—their WAN links live on the central VyOS routers managed by ${siteName}. When running a failover test from a remote branch (e.g. "failover de BR2 à DC1" or "BR5 à DC1"), the convergence probe ('run_test(profile="conv")' or 'run_automated_failover_test') runs on the remote branch (e.g. BR2 or BR5), while VyOS interface lookup and fault injection happen on the central VyOS router (using the interface matching that branch, e.g. BR2-INET-226 for BR2).

YOUR ROLE & MANDATORY RELIABILITY RULES:
1. Assist network and security engineers with diagnosing paths, running validation tests, and analyzing telemetry.
2. MANDATORY TOOL INVOCATION (ZERO HALLUCINATION POLICY):
   - You MUST ALWAYS invoke the corresponding tool for EVERY configuration change, action, status check, or follow-up question in the CURRENT turn.
   - NEVER claim an action succeeded (e.g., "✅ Probe added", "✅ Probe removed", "🟢 Traffic started", "✅ App deleted", "✅ QoS applied") unless you actually invoked the mutation tool in THIS turn and verified its output.
   - NEVER rely on previous conversation turns to assume a state is unchanged or that an action happens automatically. If the user says "remove them", "delete it", "relance le trafic", "c'est fini ?", or "es-tu sûr ?", you MUST invoke the corresponding tool right now.
   - NEVER invent or hallucinate metrics, throughput numbers (Mbps), latency (RTT), packet loss, health scores, timestamps, or test states. Always retrieve actual values from tool outputs.
   - When launching an XFR speedtest via 'run_test', ALWAYS call 'get_test_status' immediately after in the same turn to obtain the final completed metrics.
   - When launching a convergence test ('CONV-*') via 'run_test(profile="conv")': unless the user explicitly asks to leave it running continuously in the background, ALWAYS call 'get_test_status(wait_seconds=15)' (or the user's requested duration) and then call 'stop_test' in the SAME turn so you receive and present the final PoC Test Analysis output immediately.
   - When the user asks for a "failover test" (e.g. "lance un test failover de BR2 à DC1"), prefer calling 'run_automated_failover_test(agent_id="BR2", target="DC1", fault_type="interface-down")' (which automatically starts the probe on the source branch, cuts the matching site WAN interface on the central VyOS router, measures failover, rolls back the interface, stops the probe, and returns the PoC Test Analysis).
   - CONVERGENCE PoC TEST ANALYSIS OUTPUT: Whenever a convergence test finishes ('stop_test' or 'run_automated_failover_test') OR the user asks for the output/report of the last or a specific convergence test (via 'get_convergence_report' or 'get_convergence_history'), ALWAYS present a structured **PoC Test Analysis** summary matching the Failover UI card:
     * **Test ID & Target** (e.g. \`CONV-0022 (DC1-LAN)\`), **Verdict** (\`PERFECT\`, \`GOOD\`, \`DEGRADED\`, \`BAD\`, \`CRITICAL\`), **Max Outage** (\`0ms\` / \`1.25s\`), **Duration** (\`25s\`), and **Timestamp**
     * **Curves Summary**: **RTT Latency (Avg)**, **Jitter (Avg)**, **Packet Loss Spike (Peak %)**
     * **100-Packet Sequence / Outage Detection**: \`<echo_server_received>/<sent> PACKETS (<tx_loss_pct>% TX LOSS)\` (Sent / Echo / Received)
     * **Directional Loss & Path**: **Uplink Loss (↑ TX % / ms)**, **Downlink Loss (↓ RX % / ms)**, and **Egress Path** (plus **Path Evolution** if failover occurred).
   - If a tool returns an error (e.g., probe not found, node not found, app not found), report that exact error honestly. NEVER fabricate fallback metrics for non-existent probes or nodes, and NEVER invent CLI commands or flags (such as 'stigix-cli --prune-orphans').
3. CONCISENESS, STRICT SCOPE & ZERO INTERNAL PLUMBING (CRITICAL):
   - Be concise, direct, and factual. Avoid conversational fluff, filler phrases, and unnecessary preamble.
   - Deliver the key data and diagnostic findings immediately using compact Markdown tables, short bullet points, and status indicators (🟢, 🟡, 🔴).
   - STRICT SCOPE DISCIPLINE: Answer ONLY what the user asked. If the user asks about a specific subset (e.g., "Microsoft probes", "Teams", a specific site, or a specific interface), filter and present ONLY that subset—do not dump unrelated probes, apps, or interfaces unless explicitly requested. Use tool filter parameters (such as 'probe_name_filter') whenever applicable.
   - NO UNSOLICITED INTERNAL PLUMBING: By default, NEVER mention internal tool function names (e.g., 'get_dem_summary', 'run_dem_probes_now', 'get_dem_probe_stats'), raw JSON field names ('_wasGlobal', '_source', 'flakyEndpoints', 'samples_count'), or internal storage mechanics in your prose.
   - ON-DEMAND TOOL & API TRANSPARENCY: If (and ONLY if) the user explicitly asks to see the executed tools, HTTP API calls, or raw JSON responses (e.g., "montre les appels API", "quels outils as-tu utilisé ?", "affiche la réponse JSON"), provide the exact tool names, HTTP method & endpoint ('GET /api/...', 'POST /api/...'), input parameters, and JSON payload.
4. Respond in French or English matching the user's language.
5. If the user requests high-impact or destructive actions (such as shutting down a VyOS router interface), explain what will be done succinctly and execute the tool appropriately.`;

        if (this.config.systemPromptCustom && this.config.systemPromptCustom.trim().length > 0) {
            // Strip legacy misleading instruction asking to invent CLI commands
            const sanitizedCustom = this.config.systemPromptCustom
                .trim()
                .replace(/alongside the recommended CLI troubleshooting command\.?/gi, 'and suggest the appropriate Stigix Copilot tool or check.');
            prompt += `\n\nCUSTOM OPERATOR GUIDELINES (USER-DEFINED):\n${sanitizedCustom}`;
        }

        return prompt;
    }

    private sanitizeToolId(id: string | undefined, fallback: string): string {
        const raw = (id || fallback).replace(/[^a-zA-Z0-9_-]/g, '_');
        return raw.substring(0, 60) || fallback;
    }

    private stripReasoningAndDsml(content: string | undefined): string {
        if (!content) return '';
        return content
            .replace(/^> 💭 \*\*DeepSeek Reasoning \(R1\):\*\*\n(?:> .*\n)*\n*/gm, '')
            .replace(/<[｜|]DSML[｜|][\s\S]*$/g, '')
            .trim();
    }

    private truncateHistoricalToolOutput(output: any, apiCalls?: ApiCallTrace[], maxChars: number = 1800): string {
        try {
            const payload = (apiCalls && apiCalls.length > 0 && output && typeof output === 'object')
                ? { _api_calls: apiCalls, ...output }
                : output;
            const str = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
            if (str.length <= maxChars) return str;
            return `${str.substring(0, maxChars)}... [truncated]`;
        } catch {
            return '{}';
        }
    }

    /**
     * Reconstructs multi-turn Anthropic messages including historical tool_use and tool_result blocks
     * so the model never suffers from multi-turn tool amnesia or mimics tool-free action confirmations.
     */
    private buildAnthropicMessages(session: CopilotSession): any[] {
        const recent = session.messages.slice(-16);
        const rawMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

        for (const m of recent) {
            if (m.role === 'user') {
                const text = (m.content || '').trim() || '...';
                rawMessages.push({ role: 'user', content: text });
            } else if (m.role === 'assistant') {
                const cleanText = this.stripReasoningAndDsml(m.content);
                const validTools = (m.toolCalls || []).filter(tc => Boolean(tc && (tc.tool || tc.name)));

                if (validTools.length > 0) {
                    const toolUseBlocks = validTools.map((tc, idx) => ({
                        type: 'tool_use',
                        id: this.sanitizeToolId(tc.id, `hist_${m.id}_${idx}`),
                        name: tc.tool || tc.name,
                        input: (tc.input && typeof tc.input === 'object') ? tc.input : {}
                    }));

                    const toolResultBlocks = validTools.map((tc, idx) => ({
                        type: 'tool_result',
                        tool_use_id: this.sanitizeToolId(tc.id, `hist_${m.id}_${idx}`),
                        content: this.truncateHistoricalToolOutput(
                            tc.output !== undefined ? tc.output : (tc.error ? { error: tc.error } : { status: tc.status || 'completed' }),
                            tc.apiCalls
                        )
                    }));

                    rawMessages.push({ role: 'assistant', content: toolUseBlocks });
                    rawMessages.push({ role: 'user', content: toolResultBlocks });
                    rawMessages.push({ role: 'assistant', content: cleanText || 'Tool execution completed.' });
                } else if (cleanText) {
                    rawMessages.push({ role: 'assistant', content: cleanText });
                }
            }
        }

        // Ensure first message is 'user' and merge any consecutive text messages of the same role
        const normalized: Array<{ role: 'user' | 'assistant'; content: any }> = [];
        for (const msg of rawMessages) {
            if (normalized.length === 0 && msg.role !== 'user') continue;
            const prev = normalized[normalized.length - 1];
            if (prev && prev.role === msg.role && typeof prev.content === 'string' && typeof msg.content === 'string') {
                prev.content = `${prev.content}\n\n${msg.content}`;
            } else {
                normalized.push(msg);
            }
        }
        return normalized;
    }

    /**
     * Reconstructs multi-turn DeepSeek/OpenAI messages including historical tool_calls and tool results.
     */
    private buildDeepSeekMessages(systemPrompt: string, session: CopilotSession): any[] {
        const recent = session.messages.slice(-16);
        const messages: any[] = [{ role: 'system', content: systemPrompt }];

        for (const m of recent) {
            if (m.role === 'user') {
                messages.push({ role: 'user', content: (m.content || '').trim() || '...' });
            } else if (m.role === 'assistant') {
                const cleanText = this.stripReasoningAndDsml(m.content);
                const validTools = (m.toolCalls || []).filter(tc => Boolean(tc && (tc.tool || tc.name)));

                if (validTools.length > 0) {
                    messages.push({
                        role: 'assistant',
                        content: null,
                        tool_calls: validTools.map((tc, idx) => ({
                            id: this.sanitizeToolId(tc.id, `hist_${m.id}_${idx}`),
                            type: 'function',
                            function: {
                                name: tc.tool || tc.name,
                                arguments: JSON.stringify((tc.input && typeof tc.input === 'object') ? tc.input : {})
                            }
                        }))
                    });

                    for (let idx = 0; idx < validTools.length; idx++) {
                        const tc = validTools[idx];
                        messages.push({
                            role: 'tool',
                            tool_call_id: this.sanitizeToolId(tc.id, `hist_${m.id}_${idx}`),
                            content: this.truncateHistoricalToolOutput(
                                tc.output !== undefined ? tc.output : (tc.error ? { error: tc.error } : { status: tc.status || 'completed' }),
                                tc.apiCalls
                            )
                        });
                    }

                    messages.push({
                        role: 'assistant',
                        content: cleanText || 'Tool execution completed.'
                    });
                } else if (cleanText) {
                    messages.push({ role: 'assistant', content: cleanText });
                }
            }
        }

        return messages;
    }

    /**
     * Zero-Tool-Call Anti-Hallucination Guardrail:
     * Detects when the model attempts to answer an operational query, mutation request,
     * or status verification without invoking any tool on the current turn.
     */
    private shouldForceToolExecution(userPrompt: string, candidateText: string, session: CopilotSession): boolean {
        const p = (userPrompt || '').trim();
        const t = (candidateText || '').trim();

        // Pure greeting / meta help exception
        const isPureGreeting = /^(bonjour|salut|hello|hi|hey|merci|thanks|thank you|ok|d'accord|super|parfait|aide|help|qui es-tu|who are you)[.!?\s]*$/i.test(p);
        if (isPureGreeting) return false;

        // Meta inspection exception: user explicitly asking to inspect the tools, API calls, or raw JSON of the previous turn
        const isMetaToolInspection = /\b(quel(s)? outil(s)?|quelle(s)? api|appel(s)? api|call(s)? api|api call(s)?|tool call(s)?|raw json|json brut|payload|réponse brute|reponse brute)\b/i.test(p);
        if (isMetaToolInspection && session.messages.length > 1) return false;

        // 1. Prompt contains operational verbs, Stigix entities, node names, or follow-up verification intent
        const operationalPromptRegex = /\b(add|create|remove|delete|start|stop|run|launch|execute|set|update|enable|disable|reset|clear|shut|unshut|trace|check|verify|status|state|score|health|latency|throughput|speedtest|bandwidth|xfr|probe|probes|dem|traffic|vyos|interface|eth\d+|router|vyosrouter|app|apps|tcp|voice|voip|security|eicar|dns|url|mesh|peers|endpoints|targets|convergence|failover|history|logs|diagnostics|br\d+|dc\d+|local|ajoute|ajouter|crée|créer|supprime|supprimer|retire|retirer|efface|lance|lancer|démarre|démarrer|arrête|arrêter|stoppe|stopper|relance|relancer|active|activer|désactive|désactiver|vérifie|vérifier|regarde|montre|affiche|liste|donne|quel|quelle|quels|quelles|combien|état|statut|débit|latence|sonde|sondes|trafic|routeur|fini|terminé|résultat|résultats|done|sure|sûr|sur|vrai|really|again|encore|pareil|même|same)\b/i;
        if (operationalPromptRegex.test(p)) {
            return true;
        }

        // 2. Candidate response claims an action was performed or outputs telemetry metrics / status badges without calling a tool
        const hallucinatedOutputRegex = /(✅|🟢|🔴|🟡|\b(added|removed|deleted|created|started|stopped|launched|updated|configured|applied|cleared|reset|ajouté|supprimé|retiré|créé|démarré|arrêté|lancé|relancé|terminé|appliqué|configuré)\b|\b\d+(\.\d+)?\s*(mbps|ms|pps|req\/s)\b)/i;
        if (hallucinatedOutputRegex.test(t)) {
            return true;
        }

        // 3. Multi-turn follow-up question in an active session
        if (session.messages.length > 1 && p.endsWith('?')) {
            return true;
        }

        return false;
    }

    /**
     * Executes an SSE streaming chat session with multi-turn tool execution.
     * Supports both Anthropic and DeepSeek providers seamlessly.
     */
    public async streamChat(
        sessionId: string,
        userPrompt: string,
        modelOverride: string | undefined,
        sendEvent: (event: string, data: any) => void,
        isAborted?: () => boolean
    ): Promise<void> {
        let session = this.sessions.get(sessionId);
        if (!session) {
            session = this.createSession(modelOverride);
        }

        const rawModel = modelOverride || session.model || this.config.defaultModel;
        let model = normalizeModelId(rawModel);

        const hasAnthropicKey = Boolean(this.config.apiKey && this.config.apiKey.startsWith('sk-ant-'));
        const hasDeepseekKey = Boolean(this.config.deepseekApiKey || (this.config.apiKey && !this.config.apiKey.startsWith('sk-ant-')));

        // Smart Provider & Model Reconciliation:
        // 1. If session was set to Claude but user ONLY has a DeepSeek key, auto-switch to DeepSeek!
        if (model.startsWith('claude-') && !hasAnthropicKey && hasDeepseekKey) {
            model = this.config.defaultModel?.startsWith('deepseek-') ? this.config.defaultModel : 'deepseek-chat';
        }
        // 2. If session was set to DeepSeek but user ONLY has an Anthropic key, auto-switch to Claude!
        else if (model.startsWith('deepseek-') && !hasDeepseekKey && hasAnthropicKey) {
            model = this.config.defaultModel?.startsWith('claude-') ? this.config.defaultModel : 'claude-sonnet-4-5-20250929';
        }

        session.model = model;
        session.updatedAt = Date.now();

        // Determine active provider & API key
        const isDeepSeek = model.startsWith('deepseek-');
        const activeProvider: AiProvider = isDeepSeek ? 'deepseek' : 'anthropic';
        const activeApiKey = isDeepSeek
            ? (this.config.deepseekApiKey || (this.config.apiKey?.startsWith('sk-ant-') ? '' : this.config.apiKey))
            : (this.config.apiKey?.startsWith('sk-ant-') ? this.config.apiKey : '');

        if (!activeApiKey) {
            const providerName = isDeepSeek ? 'DeepSeek' : 'Anthropic';
            sendEvent('error', {
                type: 'error',
                error: `No ${providerName} API key configured. Please configure your key in Settings ➔ AI & Copilot.`,
                message: `No ${providerName} API key configured. Please configure your key in Settings ➔ AI & Copilot.`
            });
            return;
        }

        // If first user message, update session title
        if (session.messages.length === 0) {
            session.title = userPrompt.length > 40 ? `${userPrompt.substring(0, 37)}...` : userPrompt;
        }

        const userMsg: CopilotMessage = {
            id: `msg-${crypto.randomUUID().substring(0, 8)}`,
            role: 'user',
            content: userPrompt,
            timestamp: Date.now()
        };
        session.messages.push(userMsg);

        const systemPrompt = this.buildSystemPrompt();

        const assistantMsg: CopilotMessage = {
            id: `msg-${crypto.randomUUID().substring(0, 8)}`,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            model,
            toolCalls: [],
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
        };

        const turnStart = Date.now();
        if (activeProvider === 'deepseek') {
            await this.streamDeepSeekChat(model, activeApiKey, systemPrompt, session, userPrompt, assistantMsg, sendEvent, isAborted);
        } else {
            await this.streamAnthropicChat(model, activeApiKey, systemPrompt, session, userPrompt, assistantMsg, sendEvent, isAborted);
        }
        assistantMsg.llmDurationMs = Date.now() - turnStart;

        session.messages.push(assistantMsg);
        session.updatedAt = Date.now();
        this.persistSessions();

        sendEvent('done', {
            type: 'done',
            messageId: assistantMsg.id,
            sessionId: session.id,
            totalMessages: session.messages.length,
            llmDurationMs: assistantMsg.llmDurationMs,
            usage: assistantMsg.usage,
            guardrailTriggered: assistantMsg.guardrailTriggered
        });
    }

    /**
     * DeepSeek execution loop (supports deepseek-chat and deepseek-reasoner with full tool calling)
     */
    private async streamDeepSeekChat(
        model: string,
        apiKey: string,
        systemPrompt: string,
        session: CopilotSession,
        userPrompt: string,
        assistantMsg: CopilotMessage,
        sendEvent: (event: string, data: any) => void,
        isAborted?: () => boolean
    ): Promise<void> {
        const deepseekMessages: any[] = this.buildDeepSeekMessages(systemPrompt, session);

        const deepseekTools = COPILOT_TOOLS.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema
            }
        }));

        let continueLoop = true;
        let loopCount = 0;
        let forceRequiredToolChoice = false;
        let guardrailRetried = false;
        const MAX_TOOL_LOOPS = 20;

        while (continueLoop && loopCount < MAX_TOOL_LOOPS) {
            if (isAborted?.()) {
                console.log('[AI-COPILOT] DeepSeek chat stream aborted by client');
                break;
            }
            loopCount++;
            continueLoop = false;

            try {
                let response: Response | null = null;
                let lastFetchErr: any = null;

                // Use deepseek-chat for tool-calling turns so deepseek-reasoner never leaks raw DSML tags
                const effectiveModel = model === 'deepseek-reasoner' ? 'deepseek-chat' : model;

                const payload: any = {
                    model: effectiveModel,
                    messages: deepseekMessages,
                    max_tokens: this.config.maxTokensPerRequest || 4096,
                    tools: deepseekTools,
                    tool_choice: forceRequiredToolChoice ? 'required' : 'auto'
                };
                forceRequiredToolChoice = false;

                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        response = await fetch('https://api.deepseek.com/chat/completions', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${apiKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(payload)
                        });

                        if (response.ok) break;

                        if ([500, 502, 503, 504, 529].includes(response.status) && attempt < 3) {
                            await new Promise(r => setTimeout(r, attempt * 1000));
                            continue;
                        }
                        break;
                    } catch (netErr: any) {
                        lastFetchErr = netErr;
                        if (attempt < 3) {
                            await new Promise(r => setTimeout(r, attempt * 1000));
                            continue;
                        }
                    }
                }

                if (!response) {
                    throw lastFetchErr || new Error('Failed to reach DeepSeek API after 3 attempts');
                }

                if (!response.ok) {
                    const errBody: any = await response.json().catch(() => ({}));
                    const errMsg = errBody?.error?.message || `DeepSeek API error (HTTP ${response.status})`;
                    sendEvent('error', { type: 'error', error: errMsg, message: errMsg });
                    assistantMsg.content += `\n\n⚠️ **Error:** ${errMsg}`;
                    break;
                }

                const data: any = await response.json();
                if (data.usage && assistantMsg.usage) {
                    assistantMsg.usage.inputTokens = (assistantMsg.usage.inputTokens || 0) + (data.usage.prompt_tokens || 0);
                    assistantMsg.usage.outputTokens = (assistantMsg.usage.outputTokens || 0) + (data.usage.completion_tokens || 0);
                    assistantMsg.usage.totalTokens = (assistantMsg.usage.totalTokens || 0) + (data.usage.total_tokens || 0);
                }

                const choice = data.choices?.[0];
                const resMsg = choice?.message;

                if (!resMsg) {
                    throw new Error('Empty response from DeepSeek API');
                }

                const toolCalls = resMsg.tool_calls || [];
                const cleanedContent = this.stripReasoningAndDsml(resMsg.content || '');

                // Anti-Hallucination Zero-Tool Guardrail on first loop
                if (
                    toolCalls.length === 0 &&
                    (assistantMsg.toolCalls?.length || 0) === 0 &&
                    !guardrailRetried &&
                    this.shouldForceToolExecution(userPrompt, cleanedContent, session)
                ) {
                    guardrailRetried = true;
                    assistantMsg.guardrailTriggered = true;
                    forceRequiredToolChoice = true;
                    deepseekMessages.push({
                        role: 'system',
                        content: 'CRITICAL GUARDRAIL: You did not invoke any tool for this turn. You MUST call the appropriate Stigix tool to execute the action or verify live node state before answering. Never assume or fabricate results.'
                    });
                    continueLoop = true;
                    continue;
                }

                // If DeepSeek-R1 returned reasoning_content, stream as formatted thought block
                if (resMsg.reasoning_content) {
                    assistantMsg.reasoning = resMsg.reasoning_content;
                    const reasoningBlock = `> 💭 **DeepSeek Reasoning (R1):**\n> ${resMsg.reasoning_content.replace(/\n/g, '\n> ')}\n\n`;
                    assistantMsg.content += reasoningBlock;
                    sendEvent('chunk', { type: 'chunk', text: reasoningBlock, delta: reasoningBlock });
                }

                // Emit regular text content
                if (cleanedContent) {
                    assistantMsg.content += cleanedContent;
                    sendEvent('chunk', { type: 'chunk', text: cleanedContent, delta: cleanedContent });
                }

                // Handle tool calls
                if (toolCalls.length > 0) {
                    deepseekMessages.push({
                        role: 'assistant',
                        content: cleanedContent || null,
                        tool_calls: toolCalls
                    });

                    for (const tc of toolCalls) {
                        let parsedInput: any = {};
                        try {
                            parsedInput = typeof tc.function?.arguments === 'string'
                                ? JSON.parse(tc.function.arguments)
                                : (tc.function?.arguments || {});
                        } catch {
                            parsedInput = {};
                        }

                        const toolCall: CopilotToolCall = {
                            id: tc.id,
                            tool: tc.function?.name,
                            name: tc.function?.name,
                            input: parsedInput,
                            status: 'running'
                        };
                        assistantMsg.toolCalls?.push(toolCall);

                        sendEvent('tool_call', {
                            type: 'tool_call',
                            toolCall
                        });

                        const execStart = Date.now();
                        const apiTrace: ApiCallTrace[] = [];
                        const result = await executeCopilotTool(toolCall.tool, parsedInput, {
                            ...this.executionContext,
                            _apiTrace: apiTrace
                        });
                        const dur = Date.now() - execStart;

                        toolCall.output = result;
                        toolCall.durationMs = dur;
                        toolCall.apiCalls = apiTrace;
                        toolCall.status = result?.error ? 'failed' : 'completed';
                        toolCall.error = result?.error;

                        sendEvent('tool_call', {
                            type: 'tool_call',
                            toolCall
                        });

                        deepseekMessages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: JSON.stringify(apiTrace.length > 0 && result && typeof result === 'object' ? { _api_calls: apiTrace, ...result } : result)
                        });
                    }

                    continueLoop = true;
                }

            } catch (streamErr: any) {
                sendEvent('error', { type: 'error', error: `DeepSeek stream failure: ${streamErr?.message || streamErr}`, message: `DeepSeek stream failure: ${streamErr?.message || streamErr}` });
                break;
            }
        }
    }

    /**
     * Anthropic Messages API execution loop
     */
    private async streamAnthropicChat(
        model: string,
        apiKey: string,
        systemPrompt: string,
        session: CopilotSession,
        userPrompt: string,
        assistantMsg: CopilotMessage,
        sendEvent: (event: string, data: any) => void,
        isAborted?: () => boolean
    ): Promise<void> {
        const anthropicMessages: any[] = this.buildAnthropicMessages(session);

        let continueLoop = true;
        let loopCount = 0;
        let forceAnyToolChoice = false;
        let guardrailRetried = false;
        const MAX_TOOL_LOOPS = 20;

        while (continueLoop && loopCount < MAX_TOOL_LOOPS) {
            if (isAborted?.()) {
                console.log('[AI-COPILOT] Anthropic stream aborted by client');
                break;
            }
            loopCount++;
            continueLoop = false;

            try {
                let response: Response | null = null;
                let lastFetchErr: any = null;

                const reqPayload: any = {
                    model,
                    max_tokens: this.config.maxTokensPerRequest || 4096,
                    system: systemPrompt,
                    messages: anthropicMessages,
                    tools: COPILOT_TOOLS.map(t => ({
                        name: t.name,
                        description: t.description,
                        input_schema: t.input_schema
                    }))
                };

                if (forceAnyToolChoice) {
                    reqPayload.tool_choice = { type: 'any' };
                    forceAnyToolChoice = false;
                }

                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        response = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: {
                                'x-api-key': apiKey,
                                'anthropic-version': '2023-06-01',
                                'content-type': 'application/json'
                            },
                            body: JSON.stringify(reqPayload)
                        });

                        if (response.ok) break;

                        if ([500, 502, 503, 504, 529].includes(response.status) && attempt < 3) {
                            await new Promise(r => setTimeout(r, attempt * 1000));
                            continue;
                        }
                        break;
                    } catch (netErr: any) {
                        lastFetchErr = netErr;
                        if (attempt < 3) {
                            await new Promise(r => setTimeout(r, attempt * 1000));
                            continue;
                        }
                    }
                }

                if (!response) {
                    throw lastFetchErr || new Error('Failed to reach Anthropic API after 3 attempts');
                }

                if (!response.ok) {
                    const errBody = await response.json().catch(() => ({}));
                    const errMsg = errBody?.error?.message || `Anthropic API error (HTTP ${response.status})`;
                    sendEvent('error', { type: 'error', error: errMsg, message: errMsg });
                    assistantMsg.content += `\n\n⚠️ **Error:** ${errMsg}`;
                    break;
                }

                const data: any = await response.json();
                if (data.usage && assistantMsg.usage) {
                    const inTok = data.usage.input_tokens || 0;
                    const outTok = data.usage.output_tokens || 0;
                    assistantMsg.usage.inputTokens = (assistantMsg.usage.inputTokens || 0) + inTok;
                    assistantMsg.usage.outputTokens = (assistantMsg.usage.outputTokens || 0) + outTok;
                    assistantMsg.usage.totalTokens = (assistantMsg.usage.totalTokens || 0) + inTok + outTok;
                }

                const contentBlocks = data.content || [];
                const hasToolUse = contentBlocks.some((b: any) => b.type === 'tool_use');
                const candidateText = contentBlocks
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text || '')
                    .join('');

                // Anti-Hallucination Zero-Tool Guardrail on first loop
                if (
                    !hasToolUse &&
                    (assistantMsg.toolCalls?.length || 0) === 0 &&
                    !guardrailRetried &&
                    this.shouldForceToolExecution(userPrompt, candidateText, session)
                ) {
                    guardrailRetried = true;
                    assistantMsg.guardrailTriggered = true;
                    forceAnyToolChoice = true;
                    const lastMsg = anthropicMessages[anthropicMessages.length - 1];
                    if (lastMsg && lastMsg.role === 'user' && typeof lastMsg.content === 'string') {
                        lastMsg.content = `${lastMsg.content}\n\n[SYSTEM REMINDER: You MUST invoke the appropriate Stigix tool to execute this request or verify live state. Do not answer from memory or assume state.]`;
                    }
                    continueLoop = true;
                    continue;
                }

                const toolResults: any[] = [];

                for (const block of contentBlocks) {
                    if (block.type === 'text') {
                        assistantMsg.content += block.text;
                        sendEvent('chunk', { type: 'chunk', text: block.text, delta: block.text });
                    } else if (block.type === 'tool_use') {
                        const toolCall: CopilotToolCall = {
                            id: block.id,
                            tool: block.name,
                            name: block.name,
                            input: block.input || {},
                            status: 'running'
                        };
                        assistantMsg.toolCalls?.push(toolCall);

                        sendEvent('tool_call', {
                            type: 'tool_call',
                            toolCall
                        });

                        const execStart = Date.now();
                        const apiTrace: ApiCallTrace[] = [];
                        const result = await executeCopilotTool(block.name, block.input || {}, {
                            ...this.executionContext,
                            _apiTrace: apiTrace
                        });
                        const dur = Date.now() - execStart;

                        toolCall.output = result;
                        toolCall.durationMs = dur;
                        toolCall.apiCalls = apiTrace;
                        toolCall.status = result?.error ? 'failed' : 'completed';
                        toolCall.error = result?.error;

                        sendEvent('tool_call', {
                            type: 'tool_call',
                            toolCall
                        });

                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: block.id,
                            content: JSON.stringify(apiTrace.length > 0 && result && typeof result === 'object' ? { _api_calls: apiTrace, ...result } : result)
                        });
                    }
                }

                if (toolResults.length > 0 && data.stop_reason === 'tool_use') {
                    anthropicMessages.push({
                        role: 'assistant',
                        content: contentBlocks
                    });
                    anthropicMessages.push({
                        role: 'user',
                        content: toolResults
                    });
                    continueLoop = true;
                }

            } catch (streamErr: any) {
                sendEvent('error', { type: 'error', error: `Anthropic stream failure: ${streamErr?.message || streamErr}`, message: `Anthropic stream failure: ${streamErr?.message || streamErr}` });
                break;
            }
        }
    }
}
