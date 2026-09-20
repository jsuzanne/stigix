/**
 * Stigix In-App AI Copilot — Core AI Manager
 * Manages BYOK key storage, Anthropic Messages API communication, tool dispatching, and streaming SSE responses.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
    AiConfig,
    AiPublicConfig,
    CopilotSession,
    CopilotMessage,
    CopilotToolCall
} from './types.js';
import { COPILOT_TOOLS, executeCopilotTool, ToolExecutionContext } from './ai-tools.js';

export const AVAILABLE_MODELS = [
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5 (Recommended)', description: 'Best balance of intelligence, speed, and tool calling precision' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (Fast)', description: 'Ultra-fast response time for rapid diagnostics' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Next-gen Sonnet reasoning engine' },
    { id: 'claude-sonnet-5', name: 'Claude Sonnet 5 (Latest)', description: 'Flagship frontier intelligence for complex network orchestration' },
    { id: 'claude-opus-4-5-20251101', name: 'Claude Opus 4.5', description: 'High-capability model for complex multi-step diagnostics' }
];

export function normalizeModelId(modelId?: string): string {
    if (!modelId) return 'claude-sonnet-4-5-20250929';
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

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
        const configDir = path.join(projectRoot, 'config');
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
        const envKey = process.env.ANTHROPIC_API_KEY || '';
        const defaultCfg: AiConfig = {
            enabled: true,
            apiKey: envKey,
            defaultModel: 'claude-sonnet-4-5-20250929',
            requireConfirmation: true,
            maxTokensPerRequest: 4096
        };

        if (fs.existsSync(this.configPath)) {
            try {
                const saved = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                return {
                    ...defaultCfg,
                    ...saved,
                    apiKey: saved.apiKey || envKey,
                    defaultModel: normalizeModelId(saved.defaultModel)
                };
            } catch {}
        }
        return defaultCfg;
    }

    public saveConfig(patch: Partial<AiConfig>): AiPublicConfig {
        this.config = {
            ...this.config,
            ...patch,
            defaultModel: normalizeModelId(patch.defaultModel || this.config.defaultModel)
        };
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
            try { fs.chmodSync(this.configPath, 0o600); } catch {}
        } catch (e: any) {
            console.error('[AI-MANAGER] Failed to persist ai-config.json:', e.message);
        }
        return this.getPublicConfig();
    }

    public getPublicConfig(): AiPublicConfig {
        const key = this.config.apiKey || '';
        let masked = '';
        if (key.length > 10) {
            masked = `${key.substring(0, 10)}••••••••••••${key.substring(key.length - 4)}`;
        } else if (key.length > 0) {
            masked = '••••••••••••';
        }

        return {
            enabled: this.config.enabled !== false,
            hasKey: Boolean(this.config.apiKey && this.config.apiKey.startsWith('sk-ant-')),
            maskedKey: masked,
            keyMasked: masked,
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
     * Validates an Anthropic API Key using the official /v1/models endpoint.
     */
    public async testApiKey(apiKey: string): Promise<{ valid: boolean; error?: string; models?: string[] }> {
        if (!apiKey || !apiKey.startsWith('sk-ant-')) {
            return { valid: false, error: 'Invalid API key format. Key must start with "sk-ant-"' };
        }

        try {
            // 1. First test authentication and retrieve available models
            const modelsRes = await fetch('https://api.anthropic.com/v1/models', {
                method: 'GET',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01'
                }
            });

            if (modelsRes.ok) {
                const modelsData: any = await modelsRes.json().catch(() => ({}));
                const availableModels = (modelsData?.data || []).map((m: any) => m.id);
                console.log(`[COPILOT_TEST_KEY] Key is valid! Available models:`, availableModels);
                return { valid: true, models: availableModels };
            }

            const errData: any = await modelsRes.json().catch(() => ({}));
            console.log(`[COPILOT_TEST_KEY] /v1/models status=${modelsRes.status}:`, errData);

            if (modelsRes.status === 401) {
                return { valid: false, error: 'Authentication failed: Invalid API key.' };
            }
            if (modelsRes.status === 403) {
                return { valid: false, error: errData?.error?.message || 'Access forbidden: Check workspace permissions in Anthropic Console.' };
            }
        } catch (e: any) {
            console.log(`[COPILOT_TEST_KEY] /v1/models fetch failed:`, e);
        }

        // 2. Fallback: try pinging messages API with claude-haiku-4-5
        try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
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
                return { valid: true };
            }

            const errData = await res.json().catch(() => ({}));
            return { valid: false, error: errData?.error?.message || `HTTP ${res.status}: Validation error` };
        } catch (e: any) {
            return { valid: false, error: `Connection failed: ${e?.message || e}` };
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
2. When asked about nodes, targets, or mesh state, call the available tools (e.g., list_endpoints, get_mesh_status) to retrieve live, accurate data rather than guessing.
3. Present diagnostic summaries with clean Markdown tables, status indicators (🟢, 🟡, 🔴), and exact CLI / config snippets.
4. Respond in French or English matching the user's language.
5. If the user requests high-impact or destructive actions (such as shutting down a VyOS router interface), explain what will be done and use the tool appropriately.`;
    }

    /**
     * Executes an SSE streaming chat session with multi-turn tool execution.
     */
    public async streamChat(
        sessionId: string,
        userPrompt: string,
        modelOverride: string | undefined,
        sendEvent: (event: string, data: any) => void
    ): Promise<void> {
        if (!this.config.apiKey) {
            sendEvent('error', { type: 'error', error: 'No Anthropic API key configured. Please configure your key in Settings ➔ AI & Copilot.', message: 'No Anthropic API key configured. Please configure your key in Settings ➔ AI & Copilot.' });
            return;
        }

        let session = this.sessions.get(sessionId);
        if (!session) {
            session = this.createSession(modelOverride);
        }

        const rawModel = modelOverride || session.model || this.config.defaultModel;
        const model = normalizeModelId(rawModel);
        session.model = model;
        session.updatedAt = Date.now();

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

        // Convert session history to Anthropic API message format
        const anthropicMessages: any[] = session.messages.map(m => ({
            role: m.role,
            content: m.content
        }));

        const systemPrompt = this.buildSystemPrompt();

        const assistantMsg: CopilotMessage = {
            id: `msg-${crypto.randomUUID().substring(0, 8)}`,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            model,
            toolCalls: []
        };

        // Multi-turn loop: handles assistant text and sequential tool executions
        let continueLoop = true;
        let loopCount = 0;
        const MAX_TOOL_LOOPS = 5;

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
                                'x-api-key': this.config.apiKey,
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

                        // If transient server error (500, 502, 503, 504, 529), retry after backoff
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

                // Process content blocks (text and tool_use)
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

                        // Execute tool locally
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

                // If tools were called, feed tool_results back to Claude for final synthesis
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
                sendEvent('error', { type: 'error', error: `Stream failure: ${streamErr?.message || streamErr}`, message: `Stream failure: ${streamErr?.message || streamErr}` });
                break;
            }
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
}
