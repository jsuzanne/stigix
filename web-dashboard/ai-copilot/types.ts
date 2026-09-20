/**
 * Stigix In-App AI Copilot — Type Definitions
 */

export interface AiConfig {
    enabled: boolean;
    apiKey: string;
    defaultModel: string;
    requireConfirmation: boolean;
    systemPromptCustom?: string;
    maxTokensPerRequest?: number;
}

export interface AiPublicConfig {
    enabled: boolean;
    hasKey: boolean;
    maskedKey: string;
    defaultModel: string;
    requireConfirmation: boolean;
}

export interface CopilotMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    model?: string;
    toolCalls?: CopilotToolCall[];
}

export interface CopilotToolCall {
    id: string;
    tool: string;
    input: Record<string, any>;
    output?: any;
    status: 'pending' | 'running' | 'confirm_required' | 'completed' | 'failed' | 'cancelled';
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
