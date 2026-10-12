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

        return `You are Stigix AI Copilot, an expert AI assistant embedded inside the Stigix SD-WAN and SASE Validation Platform.

CURRENT LAB CONTEXT:
- Local Stigix Node: ${siteName} (${role})
- Connected Mesh Peers: ${peersCount} active remote peers
- Platform Capabilities: SaaS Traffic Generation, Real-Time APM/RUM, Digital Experience (DEM) Probes, SASE Security Testing (URL, DNS, C2, AI Security), Voice RTP Simulation, Custom TCP East-West Apps, VyOS Router Control, and Convergence Lab.

YOUR ROLE & BEHAVIOR:
1. Assist network and security engineers with diagnosing paths, running validation tests, and analyzing telemetry.
2. When asked to perform any configuration change, test, or query (e.g., adding or removing DEM synthetic probes, running speedtests or convergence tests, controlling VyOS routers, listing endpoints):
   - You MUST ALWAYS invoke the corresponding tool (e.g., 'run_test', 'get_test_status', 'stop_test', 'add_dem_probe', 'remove_dem_probe', 'run_security_test', 'vyos_chaos', 'list_endpoints').
   - You HAVE full capabilities to launch speedtests ('run_test' with profile 'xfr'), convergence tests ('run_test' with profile 'conv'), custom TCP apps, and DEM probes.
   - NEVER invent or hallucinate metrics, throughput numbers (Mbps), latency (RTT), packet loss, timestamps, dates, or test states. Always retrieve the actual values directly from 'get_test_status' or 'list_speedtest_history'.
   - If a test is still running, clearly state that it is in progress and do not make up final throughput or RTT figures.
   - If a tool execution fails, report the exact error message received from the tool.
3. Present diagnostic summaries with clean Markdown tables, status indicators (🟢, 🟡, 🔴), and exact CLI / config snippets.
4. Respond in French or English matching the user's language.
5. If the user requests high-impact or destructive actions (such as shutting down a VyOS router interface), explain what will be done and use the tool appropriately.`;
    }

    /**
     * Executes an SSE streaming chat session with multi-turn tool execution.
     * Supports both Anthropic and DeepSeek providers seamlessly.
     */
    public async streamChat(
        sessionId: string,
        userPrompt: string,
        modelOverride: string | undefined,
        sendEvent: (event: string, data: any) => void
    ): Promise<void> {
        let session = this.sessions.get(sessionId);
        if (!session) {
            session = this.createSession(modelOverride);
        }

        const rawModel = modelOverride || session.model || this.config.defaultModel;
        const model = normalizeModelId(rawModel);
        session.model = model;
        session.updatedAt = Date.now();

        // Determine active provider & API key
        const isDeepSeek = model.startsWith('deepseek-') || (this.config.provider === 'deepseek' && !model.startsWith('claude-'));
        const activeProvider: AiProvider = isDeepSeek ? 'deepseek' : 'anthropic';
        const activeApiKey = isDeepSeek
            ? (this.config.deepseekApiKey || this.config.apiKey)
            : (this.config.apiKey || this.config.deepseekApiKey);

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
            toolCalls: []
        };

        if (activeProvider === 'deepseek') {
            await this.streamDeepSeekChat(model, activeApiKey, systemPrompt, session, assistantMsg, sendEvent);
        } else {
            await this.streamAnthropicChat(model, activeApiKey, systemPrompt, session, assistantMsg, sendEvent);
        }

        session.messages.push(assistantMsg);
        session.updatedAt = Date.now();
        this.persistSessions();

        sendEvent('done', {
            type: 'done',
            messageId: assistantMsg.id,
            sessionId: session.id,
            totalMessages: session.messages.length
        });
    }

    /**
     * DeepSeek execution loop (supports deepseek-chat with OpenAI tool calls, and deepseek-reasoner R1)
     */
    private async streamDeepSeekChat(
        model: string,
        apiKey: string,
        systemPrompt: string,
        session: CopilotSession,
        assistantMsg: CopilotMessage,
        sendEvent: (event: string, data: any) => void
    ): Promise<void> {
        const deepseekMessages: any[] = [
            { role: 'system', content: systemPrompt },
            ...session.messages.map(m => ({
                role: m.role,
                content: m.content
            }))
        ];

        // DeepSeek-V3 supports function calling; DeepSeek-R1 reasoner does not currently support tools
        const supportsTools = model === 'deepseek-chat';
        const deepseekTools = supportsTools ? COPILOT_TOOLS.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.input_schema
            }
        })) : undefined;

        let continueLoop = true;
        let loopCount = 0;
        const MAX_TOOL_LOOPS = 10;

        while (continueLoop && loopCount < MAX_TOOL_LOOPS) {
            loopCount++;
            continueLoop = false;

            try {
                let response: Response | null = null;
                let lastFetchErr: any = null;

                const payload: any = {
                    model,
                    messages: deepseekMessages,
                    max_tokens: this.config.maxTokensPerRequest || 4096
                };

                if (supportsTools && deepseekTools && deepseekTools.length > 0) {
                    payload.tools = deepseekTools;
                    payload.tool_choice = 'auto';
                }

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
                const choice = data.choices?.[0];
                const resMsg = choice?.message;

                if (!resMsg) {
                    throw new Error('Empty response from DeepSeek API');
                }

                // If DeepSeek-R1 returned reasoning_content, stream as formatted thought block
                if (resMsg.reasoning_content) {
                    assistantMsg.reasoning = resMsg.reasoning_content;
                    const reasoningBlock = `> 💭 **DeepSeek Reasoning (R1):**\n> ${resMsg.reasoning_content.replace(/\n/g, '\n> ')}\n\n`;
                    assistantMsg.content += reasoningBlock;
                    sendEvent('chunk', { type: 'chunk', text: reasoningBlock, delta: reasoningBlock });
                }

                // Emit regular text content
                if (resMsg.content) {
                    assistantMsg.content += resMsg.content;
                    sendEvent('chunk', { type: 'chunk', text: resMsg.content, delta: resMsg.content });
                }

                // Handle tool calls
                const toolCalls = resMsg.tool_calls || [];
                if (toolCalls.length > 0 && supportsTools) {
                    deepseekMessages.push({
                        role: 'assistant',
                        content: resMsg.content || null,
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
                        const result = await executeCopilotTool(toolCall.tool, parsedInput, this.executionContext);
                        const dur = Date.now() - execStart;

                        toolCall.output = result;
                        toolCall.durationMs = dur;
                        toolCall.status = result?.error ? 'failed' : 'completed';
                        toolCall.error = result?.error;

                        sendEvent('tool_call', {
                            type: 'tool_call',
                            toolCall
                        });

                        deepseekMessages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: JSON.stringify(result)
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
        assistantMsg: CopilotMessage,
        sendEvent: (event: string, data: any) => void
    ): Promise<void> {
        const anthropicMessages: any[] = session.messages.map(m => ({
            role: m.role,
            content: m.content
        }));

        let continueLoop = true;
        let loopCount = 0;
        const MAX_TOOL_LOOPS = 10;

        while (continueLoop && loopCount < MAX_TOOL_LOOPS) {
            loopCount++;
            continueLoop = false;

            try {
                let response: Response | null = null;
                let lastFetchErr: any = null;

                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        response = await fetch('https://api.anthropic.com/v1/messages', {
                            method: 'POST',
                            headers: {
                                'x-api-key': apiKey,
                                'anthropic-version': '2023-06-01',
                                'content-type': 'application/json'
                            },
                            body: JSON.stringify({
                                model,
                                max_tokens: this.config.maxTokensPerRequest || 4096,
                                system: systemPrompt,
                                messages: anthropicMessages,
                                tools: COPILOT_TOOLS.map(t => ({
                                    name: t.name,
                                    description: t.description,
                                    input_schema: t.input_schema
                                }))
                            })
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
                const contentBlocks = data.content || [];
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
                        const result = await executeCopilotTool(block.name, block.input || {}, this.executionContext);
                        const dur = Date.now() - execStart;

                        toolCall.output = result;
                        toolCall.durationMs = dur;
                        toolCall.status = result?.error ? 'failed' : 'completed';
                        toolCall.error = result?.error;

                        sendEvent('tool_call', {
                            type: 'tool_call',
                            toolCall
                        });

                        toolResults.push({
                            type: 'tool_result',
                            tool_use_id: block.id,
                            content: JSON.stringify(result)
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
