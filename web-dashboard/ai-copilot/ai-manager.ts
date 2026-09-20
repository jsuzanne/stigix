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
            defaultModel: 'claude-3-5-sonnet-20241022',
            requireConfirmation: true,
            maxTokensPerRequest: 4096
        };

        if (fs.existsSync(this.configPath)) {
            try {
                const saved = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
                return {
                    ...defaultCfg,
                    ...saved,
                    apiKey: saved.apiKey || envKey
                };
            } catch {}
        }
        return defaultCfg;
    }

    public saveConfig(patch: Partial<AiConfig>): AiPublicConfig {
        this.config = {
            ...this.config,
            ...patch
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
            defaultModel: this.config.defaultModel || 'claude-3-5-sonnet-20241022',
            requireConfirmation: this.config.requireConfirmation !== false
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
            model: model || this.config.defaultModel || 'claude-3-5-sonnet-20241022',
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
     * Validates an Anthropic API Key.
     */
    public async testApiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
        if (!apiKey || !apiKey.startsWith('sk-ant-')) {
            return { valid: false, error: 'Invalid API key format. Key must start with "sk-ant-"' };
        }

        try {
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'content-type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 10,
                    messages: [{ role: 'user', content: 'Ping' }]
                })
            });

            if (res.ok) {
                return { valid: true };
            }
            const errData = await res.json().catch(() => ({}));
            return { valid: false, error: errData?.error?.message || `HTTP ${res.status}: Invalid key` };
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
            sendEvent('error', { message: 'No Anthropic API key configured. Please configure your key in Settings ➔ AI & Copilot.' });
            return;
        }

        let session = this.sessions.get(sessionId);
        if (!session) {
            session = this.createSession(modelOverride);
        }

        const model = modelOverride || session.model || this.config.defaultModel || 'claude-3-5-sonnet-20241022';
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
                const response = await fetch('https://api.anthropic.com/v1/messages', {
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
                        tools: COPILOT_TOOLS
                    })
                });

                if (!response.ok) {
                    const errBody = await response.json().catch(() => ({}));
                    const errMsg = errBody?.error?.message || `Anthropic API error (HTTP ${response.status})`;
                    sendEvent('error', { message: errMsg });
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
                        sendEvent('text_delta', { delta: block.text });
                    } else if (block.type === 'tool_use') {
                        const toolCall: CopilotToolCall = {
                            id: block.id,
                            tool: block.name,
                            input: block.input || {},
                            status: 'running'
                        };
                        assistantMsg.toolCalls?.push(toolCall);

                        sendEvent('tool_start', {
                            toolCallId: block.id,
                            tool: block.name,
                            input: block.input
                        });

                        // Execute tool locally
                        const execStart = Date.now();
                        const result = await executeCopilotTool(block.name, block.input || {}, this.executionContext);
                        const dur = Date.now() - execStart;

                        toolCall.output = result;
                        toolCall.durationMs = dur;
                        toolCall.status = result?.error ? 'failed' : 'completed';

                        sendEvent('tool_complete', {
                            toolCallId: block.id,
                            tool: block.name,
                            result,
                            durationMs: dur
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
                sendEvent('error', { message: `Stream failure: ${streamErr?.message || streamErr}` });
                break;
            }
        }

        session.messages.push(assistantMsg);
        session.updatedAt = Date.now();
        this.persistSessions();

        sendEvent('done', {
            messageId: assistantMsg.id,
            sessionId: session.id,
            totalMessages: session.messages.length
        });
    }
}
