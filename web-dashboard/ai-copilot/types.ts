/**
 * Stigix In-App AI Copilot — Type Definitions
 * Supports multi-provider LLMs: Anthropic (Claude) & DeepSeek (V3 / R1)
 */

export type AiProvider = 'anthropic' | 'deepseek';

export interface AiConfig {
    enabled: boolean;
    provider?: AiProvider;
    apiKey: string; // Anthropic API key (sk-ant-...) or default key
    deepseekApiKey?: string; // DeepSeek API key (sk-...)
    defaultModel: string;
    requireConfirmation: boolean;
    systemPromptCustom?: string;
    maxTokensPerRequest?: number;
}

export interface AiPublicConfig {
    enabled: boolean;
    featureEnabled?: boolean;
    provider?: AiProvider;
    hasKey: boolean;
    maskedKey?: string;
    keyMasked?: string;
    hasDeepseekKey?: boolean;
    maskedDeepseekKey?: string;
    defaultModel: string;
    requireConfirmation: boolean;
    systemPromptCustom?: string;
    models?: Array<{ id: string; name: string; description: string; provider?: AiProvider }>;
}

export interface CopilotMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    reasoning?: string;
    timestamp: number;
    model?: string;
    toolCalls?: CopilotToolCall[];
    llmDurationMs?: number;
    guardrailTriggered?: boolean;
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
    };
}

export interface CopilotToolCall {
    id: string;
    tool: string;
    name?: string;
    input: Record<string, any>;
    output?: any;
    status: 'pending' | 'running' | 'confirm_required' | 'completed' | 'failed' | 'error' | 'cancelled';
    error?: string;
    durationMs?: number;
}

export interface CopilotSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    model: string;
    messages: CopilotMessage[];
}

export interface AnthropicToolDefinition {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
    isDestructive?: boolean;
}

export interface ChatStreamRequest {
    sessionId?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    model?: string;
    confirmedToolCallId?: string;
}
