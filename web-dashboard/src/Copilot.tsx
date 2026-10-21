import React, { useState, useEffect, useRef } from 'react';
import {
    Bot,
    Send,
    Plus,
    Trash2,
    Key,
    Cpu,
    Check,
    AlertCircle,
    RotateCcw,
    ChevronDown,
    ChevronRight,
    Copy,
    Wrench,
    Shield,
    Sparkles,
    Terminal,
    ExternalLink,
    Clock,
    Flame,
    Network,
    Layers,
    Activity,
    CheckCircle2,
    XCircle,
    Loader2,
    Maximize2,
    X,
    PanelLeft,
    PanelLeftClose,
    Square,
    ClipboardPaste,
    Code2
} from 'lucide-react';
import toast from 'react-hot-toast';
import { StigixSelect } from './components/common/StigixSelect';

interface ApiCallTrace {
    method: string;
    path: string;
    url?: string;
    status?: number;
    durationMs?: number;
    requestBody?: any;
}

interface CopilotToolCall {
    id: string;
    name: string;
    tool?: string;
    input: any;
    output?: any;
    status: 'running' | 'completed' | 'error' | 'failed';
    error?: string;
    durationMs?: number;
    apiCalls?: ApiCallTrace[];
}

interface CopilotMessage {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: number;
    toolCalls?: CopilotToolCall[];
    model?: string;
}

interface CopilotSession {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    messages: CopilotMessage[];
    model: string;
}

interface AiPublicConfig {
    enabled: boolean;
    hasKey: boolean;
    provider?: 'anthropic' | 'deepseek';
    keyMasked: string;
    hasDeepseekKey?: boolean;
    maskedDeepseekKey?: string;
    defaultModel: string;
    requireConfirmation: boolean;
    systemPromptCustom?: string;
    models: Array<{ id: string; name: string; description: string; provider?: 'anthropic' | 'deepseek' }>;
}

interface CopilotProps {
    token: string;
    onOpenSettings?: () => void;
    isDrawer?: boolean;
    onClose?: () => void;
    onExpandFullscreen?: () => void;
}

const STARTER_PROMPTS = [
    {
        icon: Network,
        title: "Explore Mesh & Endpoints",
        prompt: "List all active Stigix endpoints and remote targets discovered across the SD-WAN mesh with their active services."
    },
    {
        icon: Shield,
        title: "SASE Security Audit",
        prompt: "Audit my SASE security posture scores (URL, DNS, Threat Prevention, C2) and identify any security gaps."
    },
    {
        icon: Activity,
        title: "Digital Experience & SLAs",
        prompt: "Analyze the current Digital Experience (DEM) scores, packet loss, and latency metrics across all paths."
    },
    {
        icon: Flame,
        title: "VyOS Impairments & Chaos",
        prompt: "List all connected VyOS routers and explain what chaos impairment scenarios are available to test failover."
    },
    {
        icon: Layers,
        title: "Custom TCP Applications",
        prompt: "Show me all active Custom TCP & HTTP inter-site applications and their port mappings."
    }
];

export default function Copilot({ token, onOpenSettings, isDrawer = false, onClose, onExpandFullscreen }: CopilotProps) {
    const [config, setConfig] = useState<AiPublicConfig | null>(null);
    const [sessions, setSessions] = useState<CopilotSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<CopilotMessage[]>([]);
    const [inputPrompt, setInputPrompt] = useState('');
    const [selectedModel, setSelectedModel] = useState('claude-sonnet-4-5-20250929');
    const [isStreaming, setIsStreaming] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(!isDrawer);
    const [showKeyModal, setShowKeyModal] = useState(false);
    const [modalProvider, setModalProvider] = useState<'anthropic' | 'deepseek'>('anthropic');
    const [newApiKey, setNewApiKey] = useState('');
    const [isTestingKey, setIsTestingKey] = useState(false);
    const [isSavingKey, setIsSavingKey] = useState(false);
    const [customGuidelines, setCustomGuidelines] = useState('');

    const chatEndRef = useRef<HTMLDivElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const isInitialSessionLoadRef = useRef(true);

    const authHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    // Load initial config & sessions
    useEffect(() => {
        fetchConfig();
        fetchSessions();
    }, [token]);

    // Auto-scroll to bottom of chat
    useEffect(() => {
        if (!chatEndRef.current) return;

        if (isInitialSessionLoadRef.current) {
            // Instantly display bottom of conversation (no full scroll from top)
            if (chatContainerRef.current) {
                chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
            }
            chatEndRef.current.scrollIntoView({ behavior: 'auto', block: 'end' });

            const timer = setTimeout(() => {
                if (chatContainerRef.current) {
                    chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
                }
                chatEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
                isInitialSessionLoadRef.current = false;
            }, 60);

            return () => clearTimeout(timer);
        } else {
            // Live conversation: smooth scroll on new message or auto while streaming
            chatEndRef.current.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth', block: 'end' });
        }
    }, [messages, isStreaming]);

    // Auto-resize textarea
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
            textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
        }
    }, [inputPrompt]);

    const fetchConfig = async () => {
        try {
            const res = await fetch('/api/copilot/config', { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                const cfg: AiPublicConfig = data.config || data;
                setConfig(cfg);
                if (cfg.provider) {
                    setModalProvider(cfg.provider);
                } else if (cfg.hasDeepseekKey && !cfg.hasKey) {
                    setModalProvider('deepseek');
                }
                if (cfg.defaultModel) {
                    if (cfg.provider === 'deepseek' || (cfg.hasDeepseekKey && !cfg.hasKey)) {
                        setSelectedModel(cfg.defaultModel.startsWith('deepseek-') ? cfg.defaultModel : 'deepseek-chat');
                    } else {
                        setSelectedModel(cfg.defaultModel);
                    }
                }
                if (cfg.systemPromptCustom !== undefined) {
                    setCustomGuidelines(cfg.systemPromptCustom || '');
                }
            }
        } catch (e: any) {
            console.error('Failed to fetch Copilot config:', e);
        }
    };

    const fetchSessions = async () => {
        try {
            const res = await fetch('/api/copilot/sessions', { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                const list: CopilotSession[] = Array.isArray(data) ? data : (Array.isArray(data.sessions) ? data.sessions : []);
                setSessions(list);
                if (list.length > 0 && !currentSessionId) {
                    // Pick the most recent session
                    selectSession(list[0].id);
                } else if (list.length === 0) {
                    // Create an initial empty session
                    createNewSession();
                }
            }
        } catch (e: any) {
            console.error('Failed to fetch sessions:', e);
        }
    };

    const selectSession = async (sessionId: string) => {
        isInitialSessionLoadRef.current = true;
        setCurrentSessionId(sessionId);
        try {
            const res = await fetch(`/api/copilot/sessions/${sessionId}`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                const session: CopilotSession = data.session || data;
                setMessages(session.messages || []);
                if (session.model) {
                    if (session.model.startsWith('claude-') && config && !config.hasKey && config.hasDeepseekKey) {
                        setSelectedModel(config.defaultModel?.startsWith('deepseek-') ? config.defaultModel : 'deepseek-chat');
                    } else {
                        setSelectedModel(session.model);
                    }
                }
            }
        } catch (e: any) {
            console.error('Failed to load session:', e);
        }
    };

    const createNewSession = async () => {
        isInitialSessionLoadRef.current = true;
        try {
            const res = await fetch('/api/copilot/sessions', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    title: 'New Conversation',
                    model: selectedModel
                })
            });
            if (res.ok) {
                const data = await res.json();
                const newSession: CopilotSession = data.session || data;
                if (newSession && newSession.id) {
                    setSessions(prev => [newSession, ...prev.filter(s => s.id !== newSession.id)]);
                    setCurrentSessionId(newSession.id);
                    setMessages([]);
                }
            }
        } catch (e: any) {
            toast.error('Failed to create new session');
        }
    };

    const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const res = await fetch(`/api/copilot/sessions/${sessionId}`, {
                method: 'DELETE',
                headers: authHeaders
            });
            if (res.ok) {
                setSessions(prev => prev.filter(s => s.id !== sessionId));
                if (currentSessionId === sessionId) {
                    const remaining = sessions.filter(s => s.id !== sessionId);
                    if (remaining.length > 0) {
                        selectSession(remaining[0].id);
                    } else {
                        createNewSession();
                    }
                }
                toast.success('Session deleted');
            }
        } catch (e: any) {
            toast.error('Failed to delete session');
        }
    };

    const handleSaveKey = async () => {
        setIsSavingKey(true);
        try {
            const bodyPayload: any = {
                systemPromptCustom: customGuidelines.trim()
            };

            if (newApiKey.trim()) {
                bodyPayload.provider = modalProvider;
                if (modalProvider === 'deepseek') {
                    bodyPayload.deepseekApiKey = newApiKey.trim();
                } else {
                    bodyPayload.apiKey = newApiKey.trim();
                }

                if (modalProvider === 'deepseek' && selectedModel.startsWith('claude-')) {
                    bodyPayload.defaultModel = 'deepseek-chat';
                    setSelectedModel('deepseek-chat');
                } else if (modalProvider === 'anthropic' && selectedModel.startsWith('deepseek-')) {
                    bodyPayload.defaultModel = 'claude-sonnet-4-5-20250929';
                    setSelectedModel('claude-sonnet-4-5-20250929');
                }
            }

            const res = await fetch('/api/copilot/config', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify(bodyPayload)
            });
            if (res.ok) {
                const data = await res.json();
                const updated: AiPublicConfig = data.config || data;
                setConfig(updated);
                setShowKeyModal(false);
                setNewApiKey('');
                toast.success('Copilot settings saved securely!');
            } else {
                toast.error('Failed to save settings');
            }
        } catch (e: any) {
            toast.error(e.message || 'Error saving settings');
        } finally {
            setIsSavingKey(false);
        }
    };

    const handleTestKey = async () => {
        if (!newApiKey.trim()) return;
        setIsTestingKey(true);
        try {
            const res = await fetch('/api/copilot/test-key', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    apiKey: newApiKey.trim(),
                    provider: modalProvider
                })
            });
            const data = await res.json();
            if (data.success || data.valid) {
                toast.success(`API Key validated successfully with ${modalProvider === 'deepseek' ? 'DeepSeek' : 'Anthropic'}!`);
            } else {
                toast.error(`Validation failed: ${data.error}`);
            }
        } catch (e: any) {
            toast.error(e.message || 'Connection test failed');
        } finally {
            setIsTestingKey(false);
        }
    };

    const sendMessage = async (overridePrompt?: string) => {
        const text = (overridePrompt || inputPrompt).trim();
        if (!text || isStreaming) return;

        if (!config?.hasKey) {
            setShowKeyModal(true);
            return;
        }

        let activeSessionId = currentSessionId;
        if (!activeSessionId) {
            await createNewSession();
            return;
        }

        const userMsg: CopilotMessage = {
            id: `msg-${Date.now()}`,
            role: 'user',
            content: text,
            timestamp: Date.now()
        };

        const assistantMsgId = `asst-${Date.now()}`;
        const assistantMsg: CopilotMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            model: selectedModel,
            toolCalls: []
        };

        const controller = new AbortController();
        abortControllerRef.current = controller;

        isInitialSessionLoadRef.current = false;
        setMessages(prev => [...prev, userMsg, assistantMsg]);
        setInputPrompt('');
        setIsStreaming(true);

        try {
            const res = await fetch('/api/copilot/chat', {
                method: 'POST',
                headers: authHeaders,
                signal: controller.signal,
                body: JSON.stringify({
                    sessionId: activeSessionId,
                    prompt: text,
                    model: selectedModel
                })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || `HTTP error ${res.status}`);
            }

            const reader = res.body?.getReader();
            if (!reader) throw new Error('Response body stream unavailable');

            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('data: ')) continue;
                    const jsonStr = trimmed.substring(6);
                    try {
                        const event = JSON.parse(jsonStr);

                        if (event.type === 'chunk' || event.type === 'text_delta') {
                            const chunkText = event.text || event.delta || '';
                            setMessages(prev => prev.map(m => {
                                if (m.id === assistantMsgId) {
                                    return { ...m, content: m.content + chunkText };
                                }
                                return m;
                            }));
                        } else if (event.type === 'tool_call' || event.type === 'tool_start' || event.type === 'tool_complete') {
                            const tc: CopilotToolCall = event.toolCall || {
                                id: event.toolCallId || `tc-${Date.now()}`,
                                name: event.tool,
                                input: event.input || {},
                                output: event.result,
                                status: event.type === 'tool_start' ? 'running' : (event.result?.error ? 'error' : 'completed')
                            };
                            setMessages(prev => prev.map(m => {
                                if (m.id === assistantMsgId) {
                                    const existingTools = m.toolCalls || [];
                                    const matchIdx = existingTools.findIndex(t => t.id === tc.id);
                                    let nextTools = [...existingTools];
                                    if (matchIdx >= 0) {
                                        nextTools[matchIdx] = tc;
                                    } else {
                                        nextTools.push(tc);
                                    }
                                    return { ...m, toolCalls: nextTools };
                                }
                                return m;
                            }));
                        } else if (event.type === 'error') {
                            const errMsg = event.error || event.message || 'Unknown error';
                            toast.error(`Copilot error: ${errMsg}`);
                            setMessages(prev => prev.map(m => {
                                if (m.id === assistantMsgId) {
                                    return { ...m, content: m.content + `\n\n> ⚠️ **Error:** ${errMsg}` };
                                }
                                return m;
                            }));
                        } else if (event.type === 'done') {
                            fetchSessions();
                        }
                    } catch (err) {
                        console.error('Error parsing SSE event:', err, jsonStr);
                    }
                }
            }
        } catch (e: any) {
            if (e.name === 'AbortError') {
                setMessages(prev => prev.map(m => {
                    if (m.id === assistantMsgId) {
                        return { ...m, content: m.content ? m.content + '\n\n> ⏹️ *Generation stopped by user*' : '> ⏹️ *Generation stopped by user*' };
                    }
                    return m;
                }));
            } else {
                toast.error(e.message || 'Error interacting with AI Copilot');
                setMessages(prev => prev.map(m => {
                    if (m.id === assistantMsgId) {
                        return { ...m, content: m.content + `\n\n> ⚠️ **Failed to complete response:** ${e.message}` };
                    }
                    return m;
                }));
            }
        } finally {
            setIsStreaming(false);
            abortControllerRef.current = null;
        }
    };

    const handleStopGeneration = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsStreaming(false);
        toast('Generation stopped', { icon: '⏹️' });
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const copyToClipboard = (text: string, customMessage = 'Copied to clipboard') => {
        if (!text) return;
        const fallbackCopy = (val: string) => {
            try {
                const textArea = document.createElement('textarea');
                textArea.value = val;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                textArea.style.top = '0';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (ok) {
                    toast.success(customMessage);
                } else {
                    toast.error('Failed to copy to clipboard');
                }
            } catch {
                toast.error('Failed to copy to clipboard');
            }
        };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text)
                .then(() => toast.success(customMessage))
                .catch(() => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
    };

    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
    const [copiedDebugId, setCopiedDebugId] = useState<string | null>(null);
    const [expandedToolsMsgIds, setExpandedToolsMsgIds] = useState<Record<string, boolean>>({});

    const toggleMessageTools = (msgId: string) => {
        setExpandedToolsMsgIds(prev => ({ ...prev, [msgId]: !prev[msgId] }));
    };

    const handleCopyMessage = (msgId: string, text: string) => {
        if (!text) return;
        copyToClipboard(text, 'Message copied to clipboard');
        setCopiedMessageId(msgId);
        setTimeout(() => {
            setCopiedMessageId(prev => prev === msgId ? null : prev);
        }, 2000);
    };

    const formatMessageDebugBundle = (m: CopilotMessage): string => {
        const lines: string[] = [];
        const timeStr = new Date(m.timestamp).toISOString();
        lines.push(`=== [${m.role.toUpperCase()}] ${timeStr}${m.model ? ` (${m.model})` : ''} ===`);
        if (m.toolCalls && m.toolCalls.length > 0) {
            lines.push(`--- EXECUTED TOOLS & API CALLS (${m.toolCalls.length}) ---`);
            m.toolCalls.forEach((t, idx) => {
                lines.push(`[Tool #${idx + 1}] ${t.name} (status: ${t.status}${t.durationMs ? `, ${t.durationMs}ms` : ''})`);
                lines.push(`Input: ${JSON.stringify(t.input || {})}`);
                if (t.apiCalls && t.apiCalls.length > 0) {
                    t.apiCalls.forEach(api => {
                        lines.push(`API Call: ${api.method} ${api.path}${api.status ? ` -> HTTP ${api.status}` : ''}${api.durationMs !== undefined ? ` (${api.durationMs}ms)` : ''}`);
                        if (api.requestBody) {
                            lines.push(`API Body: ${typeof api.requestBody === 'string' ? api.requestBody : JSON.stringify(api.requestBody)}`);
                        }
                    });
                }
                if (t.output !== undefined) {
                    lines.push(`Output JSON:\n${typeof t.output === 'string' ? t.output : JSON.stringify(t.output, null, 2)}`);
                }
                lines.push('');
            });
        }
        lines.push(`--- MESSAGE CONTENT ---`);
        lines.push(m.content || '(empty)');
        return lines.join('\n');
    };

    const handleCopyMessageDebug = (m: CopilotMessage) => {
        const debugText = formatMessageDebugBundle(m);
        copyToClipboard(debugText, 'Copied message + API/JSON debug trace');
        setCopiedDebugId(m.id);
        setTimeout(() => {
            setCopiedDebugId(prev => prev === m.id ? null : prev);
        }, 2000);
    };

    const handleCopyFullChatDebug = () => {
        if (messages.length === 0) {
            toast.error('No messages in current conversation to copy');
            return;
        }
        const header = `# Stigix AI Copilot Debug Transcript\n# Exported: ${new Date().toISOString()}\n# Model: ${selectedModel}\n# Messages: ${messages.length}\n`;
        const body = messages.map(m => formatMessageDebugBundle(m)).join('\n\n' + '='.repeat(60) + '\n\n');
        copyToClipboard(`${header}\n${body}`, `Copied full chat debug (${messages.length} messages)`);
    };

    const handlePasteFromClipboard = async () => {
        if (navigator.clipboard && window.isSecureContext && navigator.clipboard.readText) {
            try {
                const clipText = await navigator.clipboard.readText();
                if (clipText) {
                    setInputPrompt(prev => prev ? `${prev}\n${clipText}` : clipText);
                    textareaRef.current?.focus();
                    toast.success('Pasted from clipboard');
                    return;
                }
            } catch {}
        }
        textareaRef.current?.focus();
        toast('Press Cmd+V / Ctrl+V to paste (browser restricts direct clipboard read over HTTP)', { icon: '📋' });
    };

    return (
        <div className="flex flex-col lg:flex-row h-[calc(100vh-140px)] min-h-[600px] bg-card border border-border rounded-2xl overflow-hidden shadow-2xl relative">
            {/* ── Sessions Sidebar ── */}
            <div className={`w-full lg:w-72 shrink-0 bg-card-secondary/40 border-r border-border flex flex-col transition-all duration-300 ${sidebarOpen ? 'flex' : 'hidden'}`}>
                {/* Header */}
                <div className="p-4 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 bg-blue-500/10 rounded-lg text-blue-500">
                            <Bot size={18} />
                        </div>
                        <span className="text-xs font-black uppercase tracking-wider text-text-primary">Conversations</span>
                    </div>
                    <button
                        onClick={createNewSession}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                        title="Start a new chat"
                    >
                        <Plus size={14} />
                        <span>New</span>
                    </button>
                </div>

                {/* Session List */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                    {sessions.length === 0 ? (
                        <div className="p-4 text-center text-xs text-text-muted">
                            No conversations yet.
                        </div>
                    ) : (
                        sessions.map(s => {
                            const isActive = s.id === currentSessionId;
                            return (
                                <div
                                    key={s.id}
                                    onClick={() => selectSession(s.id)}
                                    className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all ${
                                        isActive
                                            ? 'bg-blue-600/15 border border-blue-500/30 text-blue-400'
                                            : 'hover:bg-card-hover/50 text-text-secondary border border-transparent'
                                    }`}
                                >
                                    <div className="flex-1 min-w-0 pr-2">
                                        <div className="text-xs font-bold truncate text-text-primary">
                                            {s.title || 'Untitled Chat'}
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-text-muted mt-0.5">
                                            <span>{new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                            <span>•</span>
                                            <span>{s.messages?.length || 0} msgs</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => deleteSession(s.id, e)}
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 text-red-400 rounded transition-all"
                                        title="Delete chat"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* BYOK Status Footer */}
                <div className="p-3 border-t border-border bg-card/60">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Key size={14} className={config?.hasKey ? "text-emerald-400" : "text-amber-400"} />
                            <div className="flex flex-col">
                                <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">
                                    {config?.provider === 'deepseek' || (config?.hasDeepseekKey && !config?.hasKey) ? 'DeepSeek BYOK' : 'Anthropic BYOK'}
                                </span>
                                <span className="text-xs font-mono text-text-secondary truncate max-w-[120px]">
                                    {config?.provider === 'deepseek'
                                        ? (config.maskedDeepseekKey || config.keyMasked || 'No API Key')
                                        : (config?.keyMasked || config?.maskedDeepseekKey || 'No API Key')}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                setModalProvider(config?.provider || (config?.hasDeepseekKey && !config?.hasKey ? 'deepseek' : 'anthropic'));
                                setShowKeyModal(true);
                            }}
                            className="px-2 py-1 bg-card-secondary hover:bg-card-hover border border-border rounded-lg text-[10px] font-bold text-text-secondary transition-all"
                        >
                            {config?.hasKey ? 'Change' : 'Set Key'}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Main Chat Area ── */}
            <div className="flex-1 flex flex-col h-full bg-card overflow-hidden">
                {/* Top Control Bar */}
                <div className="px-4 sm:px-6 py-3 border-b border-border bg-card/80 backdrop-blur flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 sm:gap-3">
                        {/* Sidebar toggle button (especially useful in drawer mode) */}
                        <button
                            onClick={() => setSidebarOpen(prev => !prev)}
                            className="p-1.5 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-colors"
                            title={sidebarOpen ? "Hide session history" : "Show session history"}
                        >
                            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
                        </button>

                        <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl text-white shadow-md">
                            <Sparkles size={16} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-sm font-black tracking-tight text-text-primary">Stigix AI Copilot</h1>
                                <span className="hidden sm:inline px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    {selectedModel.startsWith('deepseek-') ? 'BYOK DeepSeek' : 'BYOK Claude'}
                                </span>
                            </div>
                            <p className="text-[10px] text-text-muted font-bold truncate max-w-[140px] sm:max-w-none">Local SD-WAN & SASE Orchestrator</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {messages.length > 0 && (
                            <button
                                type="button"
                                onClick={handleCopyFullChatDebug}
                                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-card-secondary hover:bg-blue-600/15 border border-border hover:border-blue-500/40 rounded-xl text-[10px] font-bold text-text-secondary hover:text-blue-400 transition-all cursor-pointer"
                                title="Copier toute la conversation + appels outils/API + JSON pour le debug"
                            >
                                <Copy size={12} />
                                <span className="hidden md:inline">Copy Chat Debug</span>
                            </button>
                        )}

                        {/* Model Selector */}
                        <StigixSelect
                            value={selectedModel}
                            onChange={(val) => setSelectedModel(val)}
                            size="xs"
                            accent="indigo"
                            triggerIcon={<Cpu size={13} className="text-indigo-400 shrink-0" />}
                            minMenuWidth={220}
                            options={
                                config?.models && config.models.length > 0
                                    ? config.models.map(m => ({ value: m.id, label: m.name }))
                                    : [
                                        { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
                                        { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
                                        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
                                        { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
                                        { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
                                    ]
                            }
                        />

                        {/* Drawer Actions: Expand to Fullscreen & Close */}
                        {isDrawer && (
                            <div className="flex items-center gap-1 pl-1 border-l border-border">
                                {onExpandFullscreen && (
                                    <button
                                        onClick={onExpandFullscreen}
                                        className="p-1.5 hover:bg-card-secondary rounded-lg text-text-muted hover:text-text-primary transition-colors"
                                        title="Open full page Copilot"
                                    >
                                        <Maximize2 size={16} />
                                    </button>
                                )}
                                {onClose && (
                                    <button
                                        onClick={onClose}
                                        className="p-1.5 hover:bg-rose-500/10 hover:text-rose-400 rounded-lg text-text-muted transition-colors"
                                        title="Close Copilot drawer (Esc)"
                                    >
                                        <X size={18} />
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Chat Feed */}
                <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
                    {/* Missing Key Warning Banner */}
                    {!config?.hasKey && (
                        <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3">
                                <AlertCircle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                                <div>
                                    <h4 className="text-xs font-black text-amber-500 uppercase tracking-wider">Anthropic Claude API Key Required</h4>
                                    <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                                        Stigix uses Bring-Your-Own-Key (BYOK) architecture to guarantee maximum privacy. Your key is stored strictly on your local Stigix instance and connects directly to Anthropic API.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                {onOpenSettings && (
                                    <button
                                        onClick={onOpenSettings}
                                        className="px-3 py-1.5 bg-card-secondary hover:bg-card-hover border border-border text-text-secondary font-bold text-xs rounded-xl whitespace-nowrap transition-all"
                                    >
                                        Settings Tab
                                    </button>
                                )}
                                <button
                                    onClick={() => setShowKeyModal(true)}
                                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-black text-xs rounded-xl whitespace-nowrap transition-all shadow-md"
                                >
                                    Quick Setup
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Empty State / Starter Prompts */}
                    {messages.length === 0 && (
                        <div className="max-w-2xl mx-auto my-8 space-y-6 animate-in fade-in duration-500">
                            <div className="text-center space-y-2">
                                <div className="inline-flex p-4 bg-gradient-to-tr from-blue-600/20 to-indigo-600/20 border border-blue-500/30 rounded-3xl text-blue-400 mb-2">
                                    <Bot size={36} />
                                </div>
                                <h3 className="text-xl font-black text-text-primary tracking-tight">How can I assist your SD-WAN mesh today?</h3>
                                <p className="text-xs text-text-muted max-w-md mx-auto">
                                    Ask questions about discovered endpoints, audit SASE security scores, inject VyOS network impairments, or inspect custom TCP applications.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                                {STARTER_PROMPTS.map((p, i) => {
                                    const Icon = p.icon;
                                    return (
                                        <button
                                            key={i}
                                            onClick={() => sendMessage(p.prompt)}
                                            className="text-left p-3.5 bg-card-secondary/40 hover:bg-blue-600/10 border border-border hover:border-blue-500/40 rounded-2xl transition-all duration-200 group flex flex-col justify-between"
                                        >
                                            <div className="flex items-center gap-2.5 mb-1.5 text-blue-400 group-hover:text-blue-300">
                                                <Icon size={16} />
                                                <span className="text-xs font-black tracking-wide text-text-primary group-hover:text-blue-400">{p.title}</span>
                                            </div>
                                            <p className="text-[11px] text-text-muted group-hover:text-text-secondary line-clamp-2 leading-relaxed">
                                                {p.prompt}
                                            </p>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Messages List */}
                    {messages.map((m) => (
                        <div
                            key={m.id}
                            className={`flex gap-3 sm:gap-4 ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in duration-300`}
                        >
                            {m.role === 'assistant' && (
                                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shrink-0 shadow-md">
                                    <Bot size={16} />
                                </div>
                            )}

                            <div className={`flex flex-col ${m.role === 'user' ? 'max-w-[85%] sm:max-w-[75%] items-end' : 'w-full max-w-full items-start'}`}>
                                <div
                                    className={`relative group/msg rounded-2xl p-4 sm:p-5 text-xs leading-relaxed shadow-sm ${
                                        m.role === 'user'
                                            ? 'bg-blue-600 text-white rounded-tr-sm font-medium'
                                            : 'bg-card-secondary/50 border border-border text-text-primary rounded-tl-sm w-full'
                                    }`}
                                >
                                    {/* On-Demand Tool Calls & API Inspector */}
                                    {m.toolCalls && m.toolCalls.length > 0 && (() => {
                                        const runningTools = m.toolCalls.filter(t => t.status === 'running');
                                        const totalApiCalls = m.toolCalls.reduce((acc, t) => acc + (t.apiCalls?.length || 0), 0);
                                        const totalDurationMs = m.toolCalls.reduce((acc, t) => acc + (t.durationMs || 0), 0);
                                        const hasErrors = m.toolCalls.some(t => t.status === 'error' || t.status === 'failed');
                                        const isToolsExpanded = Boolean(expandedToolsMsgIds[m.id]);
                                        const allApiCalls = m.toolCalls.flatMap(t => t.apiCalls || []);

                                        return (
                                            <div className="mb-3">
                                                {/* Compact On-Demand Toggle Bar */}
                                                <button
                                                    type="button"
                                                    onClick={() => toggleMessageTools(m.id)}
                                                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-[11px] transition-all cursor-pointer ${
                                                        runningTools.length > 0
                                                            ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                                                            : hasErrors
                                                                ? 'bg-red-500/10 border-red-500/30 text-red-300 hover:bg-red-500/15'
                                                                : isToolsExpanded
                                                                    ? 'bg-blue-500/10 border-blue-500/30 text-text-primary'
                                                                    : 'bg-card/60 hover:bg-card border-border/80 text-text-secondary hover:text-text-primary'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                                                        {runningTools.length > 0 ? (
                                                            <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />
                                                        ) : hasErrors ? (
                                                            <XCircle size={13} className="text-red-400 shrink-0" />
                                                        ) : (
                                                            <Terminal size={13} className="text-blue-400 shrink-0" />
                                                        )}
                                                        <span className="font-bold">
                                                            {runningTools.length > 0
                                                                ? `Exécution en cours (${runningTools.map(t => t.name || t.tool).join(', ')})...`
                                                                : `${m.toolCalls.length} outil${m.toolCalls.length > 1 ? 's' : ''}${totalApiCalls > 0 ? ` • ${totalApiCalls} appel${totalApiCalls > 1 ? 's' : ''} API` : ''}`}
                                                        </span>
                                                        {runningTools.length === 0 && allApiCalls.length > 0 && !isToolsExpanded && (
                                                            <div className="hidden sm:flex items-center gap-1.5 overflow-hidden">
                                                                {allApiCalls.slice(0, 2).map((api, idx) => (
                                                                    <span
                                                                        key={idx}
                                                                        className="px-1.5 py-0.5 rounded bg-black/25 border border-border/60 font-mono text-[10px] text-text-muted truncate max-w-[220px]"
                                                                    >
                                                                        <span className={api.method === 'POST' ? 'text-amber-400 font-bold' : api.method === 'DELETE' ? 'text-red-400 font-bold' : 'text-cyan-400 font-bold'}>
                                                                            {api.method}
                                                                        </span>{' '}
                                                                        {api.path}
                                                                    </span>
                                                                ))}
                                                                {allApiCalls.length > 2 && (
                                                                    <span className="text-[10px] text-text-muted font-mono">+{allApiCalls.length - 2}</span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex items-center gap-2 shrink-0">
                                                        {totalDurationMs > 0 && (
                                                            <span className="text-[10px] font-mono text-text-muted hidden sm:inline">
                                                                {totalDurationMs >= 1000 ? `${(totalDurationMs / 1000).toFixed(1)}s` : `${totalDurationMs}ms`}
                                                            </span>
                                                        )}
                                                        <span className="text-[10px] font-bold text-blue-400 flex items-center gap-1">
                                                            {isToolsExpanded ? 'Masquer' : 'Outils & API'}
                                                            {isToolsExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                                        </span>
                                                    </div>
                                                </button>

                                                {/* Expanded Tool & API Call Cards */}
                                                {isToolsExpanded && (
                                                    <div className="mt-2 space-y-2 animate-in fade-in duration-200">
                                                        {m.toolCalls.map(tool => (
                                                            <ToolCallCard key={tool.id} tool={tool} onCopy={copyToClipboard} defaultExpanded={true} />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}

                                    {/* Quick floating copy button on hover for all messages */}
                                    {m.content && (
                                        <button
                                            onClick={() => handleCopyMessage(m.id, m.content)}
                                            className={`absolute top-3 right-3 opacity-0 group-hover/msg:opacity-100 p-1.5 rounded-lg transition-all shadow-sm cursor-pointer z-10 ${
                                                m.role === 'user'
                                                    ? 'bg-blue-700/90 hover:bg-blue-800 border border-blue-400/40 text-blue-100 hover:text-white'
                                                    : 'bg-card/90 hover:bg-card border border-border/80 text-text-muted hover:text-text-primary'
                                            }`}
                                            title="Copy message to clipboard"
                                        >
                                            {copiedMessageId === m.id ? (
                                                <Check size={13} className="text-emerald-400" />
                                            ) : (
                                                <Copy size={13} />
                                            )}
                                        </button>
                                    )}

                                    {/* Render Markdown Content */}
                                    {m.content ? (
                                        <MarkdownRenderer content={m.content} onCopy={copyToClipboard} />
                                    ) : (
                                        isStreaming && m.role === 'assistant' && (
                                            <div className="flex items-center gap-2 text-text-muted py-1">
                                                <Loader2 size={14} className="animate-spin text-blue-400" />
                                                <span className="text-[11px] font-bold animate-pulse">Analyzing Stigix telemetry & tools...</span>
                                            </div>
                                        )
                                    )}
                                </div>

                                <div className="flex items-center gap-2 text-[10px] text-text-muted mt-1.5 px-1 flex-wrap">
                                    <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    {m.model && (
                                        <>
                                            <span>•</span>
                                            <span className="font-mono">{m.model}</span>
                                        </>
                                    )}
                                    {m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 && (
                                        <>
                                            <span>•</span>
                                            <button
                                                onClick={() => toggleMessageTools(m.id)}
                                                className={`flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors cursor-pointer ${
                                                    expandedToolsMsgIds[m.id]
                                                        ? 'bg-blue-500/20 text-blue-400 font-bold'
                                                        : 'hover:bg-card-secondary hover:text-text-primary text-text-muted'
                                                }`}
                                                title="Afficher / masquer les outils, appels API et réponses JSON"
                                            >
                                                <Terminal size={11} />
                                                <span>
                                                    {expandedToolsMsgIds[m.id] ? 'Masquer API & JSON' : `Outils & API (${m.toolCalls.length})`}
                                                </span>
                                            </button>
                                        </>
                                    )}
                                    {m.content && (
                                        <>
                                            <span>•</span>
                                            <button
                                                onClick={() => handleCopyMessage(m.id, m.content)}
                                                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-card-secondary hover:text-text-primary text-text-muted transition-colors cursor-pointer"
                                                title="Copy message text"
                                            >
                                                {copiedMessageId === m.id ? (
                                                    <>
                                                        <Check size={11} className="text-emerald-400" />
                                                        <span className="text-emerald-400 font-bold">Copied!</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Copy size={11} />
                                                        <span>Copy</span>
                                                    </>
                                                )}
                                            </button>
                                        </>
                                    )}
                                    {m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0 && (
                                        <>
                                            <span>•</span>
                                            <button
                                                onClick={() => handleCopyMessageDebug(m)}
                                                className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-blue-500/15 hover:text-blue-400 text-text-muted transition-colors cursor-pointer"
                                                title="Copy response + full tool arguments, API calls & JSON output for debugging"
                                            >
                                                {copiedMessageId === `${m.id}-debug` ? (
                                                    <>
                                                        <Check size={11} className="text-emerald-400" />
                                                        <span className="text-emerald-400 font-bold">Debug Copied!</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Code2 size={11} />
                                                        <span>Copy Debug (API/JSON)</span>
                                                    </>
                                                )}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {m.role === 'user' && (
                                <div className="w-8 h-8 rounded-xl bg-card-secondary border border-border flex items-center justify-center text-text-secondary shrink-0">
                                    <span className="text-[11px] font-black">YOU</span>
                                </div>
                            )}
                        </div>
                    ))}

                    <div ref={chatEndRef} />
                </div>

                {/* Input Controls */}
                <div className="p-4 border-t border-border bg-card/90 backdrop-blur">
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            sendMessage();
                        }}
                        className="relative bg-card-secondary/70 border border-border focus-within:border-blue-500/60 rounded-2xl transition-all shadow-inner"
                    >
                        <textarea
                            ref={textareaRef}
                            value={inputPrompt}
                            onChange={(e) => setInputPrompt(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={config?.hasKey ? "Ask Stigix Copilot anything or trigger network actions... (Enter to send, Shift+Enter for newline, Cmd/Ctrl+V to paste)" : "Please enter your Anthropic API Key above to start chat..."}
                            disabled={!config?.hasKey || isStreaming}
                            rows={1}
                            className="w-full bg-transparent text-xs text-text-primary placeholder:text-text-muted/60 p-3.5 pr-28 focus:outline-none resize-none max-h-40 custom-scrollbar disabled:opacity-50"
                        />

                        <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                            {!isStreaming && config?.hasKey && (
                                <button
                                    type="button"
                                    onClick={handlePasteFromClipboard}
                                    className="p-2 bg-card hover:bg-card-hover border border-border text-text-secondary hover:text-text-primary rounded-xl transition-all shadow-sm active:scale-95 flex items-center justify-center cursor-pointer"
                                    title="Paste from clipboard (or focus input for Ctrl+V / Cmd+V)"
                                >
                                    <ClipboardPaste size={15} />
                                </button>
                            )}
                            {isStreaming ? (
                                <button
                                    type="button"
                                    onClick={handleStopGeneration}
                                    className="p-2 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center cursor-pointer animate-pulse"
                                    title="Stop generation (Interrompre la réponse / action en cours)"
                                >
                                    <Square size={15} className="fill-current" />
                                </button>
                            ) : (
                                <button
                                    type="submit"
                                    disabled={!config?.hasKey || !inputPrompt.trim()}
                                    className="p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-card-hover disabled:text-text-muted text-white rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center cursor-pointer"
                                    title="Send Message"
                                >
                                    <Send size={16} />
                                </button>
                            )}
                        </div>
                    </form>
                    <div className="flex items-center justify-between text-[10px] text-text-muted mt-2 px-1">
                        <span>
                            {selectedModel.startsWith('deepseek-') ? 'DeepSeek API (BYOK) • Local Tool Execution • Zero Log Sharing' : 'Anthropic Claude API (BYOK) • Local Tool Execution • Zero Log Sharing'}
                        </span>
                        <span>Shift + Enter for new line • Copy/Paste ready for debug</span>
                    </div>
                </div>
            </div>

            {/* ── BYOK API Key Modal ── */}
            {showKeyModal && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="bg-card border border-border w-full max-w-lg rounded-3xl p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-200">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 bg-blue-500/10 text-blue-500 rounded-2xl">
                                    <Key size={22} />
                                </div>
                                <div>
                                    <h3 className="text-base font-black text-text-primary tracking-tight">AI Provider API Key (BYOK)</h3>
                                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Bring Your Own Key</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowKeyModal(false)}
                                className="text-text-muted hover:text-text-primary p-1 rounded-lg"
                            >
                                <XCircle size={20} />
                            </button>
                        </div>

                        {/* Provider Selection Tabs */}
                        <div className="flex bg-card-secondary/70 p-1 rounded-xl border border-border">
                            <button
                                type="button"
                                onClick={() => { setModalProvider('anthropic'); setNewApiKey(''); }}
                                className={`flex-1 py-1.5 text-xs font-black rounded-lg transition-all ${
                                    modalProvider === 'anthropic'
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'text-text-muted hover:text-text-primary'
                                }`}
                            >
                                Anthropic (Claude)
                            </button>
                            <button
                                type="button"
                                onClick={() => { setModalProvider('deepseek'); setNewApiKey(''); }}
                                className={`flex-1 py-1.5 text-xs font-black rounded-lg transition-all ${
                                    modalProvider === 'deepseek'
                                        ? 'bg-indigo-600 text-white shadow-sm'
                                        : 'text-text-muted hover:text-text-primary'
                                }`}
                            >
                                DeepSeek (V3 / R1)
                            </button>
                        </div>

                        <div className="space-y-3">
                            <p className="text-xs text-text-secondary leading-relaxed">
                                {modalProvider === 'deepseek' ? (
                                    <>
                                        Enter your DeepSeek API key from DeepSeek Platform (<code className="bg-card-secondary px-1.5 py-0.5 rounded text-indigo-400 font-mono">sk-...</code>). Supports <strong>DeepSeek-V3</strong> (tools enabled) and <strong>DeepSeek-R1</strong> (deep reasoning).
                                    </>
                                ) : (
                                    <>
                                        Enter your Claude API key from Anthropic Console (<code className="bg-card-secondary px-1.5 py-0.5 rounded text-blue-400 font-mono">sk-ant-api03-...</code>).
                                    </>
                                )}
                                {' '}Stored locally in <code className="bg-card-secondary px-1 py-0.5 rounded text-text-primary font-mono text-[10px]">config/ai-config.json</code> (chmod 600). Direct proxy with zero logs.
                            </p>

                            <div className="relative">
                                <input
                                    type="password"
                                    value={newApiKey}
                                    onChange={(e) => setNewApiKey(e.target.value)}
                                    placeholder={modalProvider === 'deepseek' ? "sk-..." : "sk-ant-api03-..."}
                                    className="w-full bg-card-secondary border border-border focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs font-mono text-text-primary focus:outline-none shadow-inner"
                                />
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                                {modalProvider === 'deepseek' ? (
                                    <a
                                        href="https://platform.deepseek.com/api_keys"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[11px] text-indigo-400 hover:underline flex items-center gap-1 font-bold"
                                    >
                                        <span>Get an API Key from DeepSeek Platform</span>
                                        <ExternalLink size={12} />
                                    </a>
                                ) : (
                                    <a
                                        href="https://console.anthropic.com/settings/keys"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[11px] text-blue-400 hover:underline flex items-center gap-1 font-bold"
                                    >
                                        <span>Get an API Key from Anthropic Console</span>
                                        <ExternalLink size={12} />
                                    </a>
                                )}
                            </div>
                        </div>

                        {/* Custom Guidelines Section */}
                        <div className="space-y-1.5 pt-2 border-t border-border">
                            <div className="flex items-center justify-between">
                                <label className="text-[11px] font-black uppercase tracking-wider text-text-primary flex items-center gap-1.5">
                                    <Sparkles size={13} className="text-amber-400" />
                                    <span>Custom Operator Guidelines</span>
                                </label>
                                <span className="text-[9px] text-text-muted">Injected into System Prompt</span>
                            </div>
                            <textarea
                                value={customGuidelines}
                                onChange={(e) => setCustomGuidelines(e.target.value)}
                                rows={2}
                                placeholder="Ex: Réponds toujours de façon concise. Alerte dès qu'une latence dépasse 40ms. Considère DC1 comme site primaire."
                                className="w-full bg-card-secondary border border-border focus:border-blue-500 rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none resize-none custom-scrollbar"
                            />
                        </div>

                        <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                            <button
                                type="button"
                                onClick={() => setShowKeyModal(false)}
                                className="px-4 py-2 bg-card-secondary hover:bg-card-hover border border-border text-text-secondary text-xs font-bold rounded-xl transition-all"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleTestKey}
                                disabled={!newApiKey.trim() || isTestingKey}
                                className="px-4 py-2 bg-card-secondary hover:bg-blue-600/10 border border-blue-500/30 text-blue-400 text-xs font-bold rounded-xl transition-all disabled:opacity-50 flex items-center gap-1.5"
                            >
                                {isTestingKey && <Loader2 size={13} className="animate-spin" />}
                                <span>Test Connection</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveKey}
                                disabled={!newApiKey.trim() || isSavingKey}
                                className={`px-5 py-2 text-white text-xs font-black rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center gap-1.5 ${
                                    modalProvider === 'deepseek' ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-blue-600 hover:bg-blue-500'
                                }`}
                            >
                                {isSavingKey && <Loader2 size={13} className="animate-spin" />}
                                <span>Save Key</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const TOOL_FALLBACK_API_MAP: Record<string, { method: string; path: string }> = {
    get_dem_summary: { method: 'GET', path: '/api/connectivity/summary' },
    get_probe_details: { method: 'GET', path: '/api/connectivity/probes/:id' },
    list_dem_probes: { method: 'GET', path: '/api/connectivity/custom' },
    get_dem_probe_stats: { method: 'GET', path: '/api/connectivity/stats' },
    run_dem_probes_now: { method: 'POST', path: '/api/connectivity/test?live=true' },
    add_dem_probe: { method: 'POST', path: '/api/connectivity/custom' },
    delete_dem_probe: { method: 'DELETE', path: '/api/connectivity/custom/:id' },
    toggle_dem_probe: { method: 'POST', path: '/api/connectivity/toggle' },
    get_traffic_stats: { method: 'GET', path: '/api/stats' },
    get_traffic_logs: { method: 'GET', path: '/api/logs' },
    get_traffic_status: { method: 'GET', path: '/api/traffic/status' },
    start_traffic: { method: 'POST', path: '/api/traffic/start' },
    stop_traffic: { method: 'POST', path: '/api/traffic/stop' },
    get_security_results_stats: { method: 'GET', path: '/api/security/stats' },
    run_security_test: { method: 'POST', path: '/api/security/run' },
    list_endpoints: { method: 'GET', path: '/api/convergence/targets' },
    run_test: { method: 'POST', path: '/api/convergence/start' },
    get_test_status: { method: 'GET', path: '/api/convergence/status' },
    stop_test: { method: 'POST', path: '/api/convergence/stop' },
    get_convergence_history: { method: 'GET', path: '/api/convergence/history' },
    get_convergence_report: { method: 'GET', path: '/api/convergence/history' },
    run_automated_failover_test: { method: 'POST', path: '/api/convergence/start' },
    list_custom_apps: { method: 'GET', path: '/api/iot/devices' },
    get_vyos_status: { method: 'GET', path: '/api/vyos/routers' },
    discover_vyos_interfaces: { method: 'POST', path: '/api/vyos/discover' },
    execute_vyos_RawCommand: { method: 'POST', path: '/api/vyos/command' }
};

// ── Tool Call Card Component ──
function ToolCallCard({
    tool,
    onCopy,
    defaultExpanded = false
}: {
    tool: CopilotToolCall;
    onCopy: (text: string) => void;
    defaultExpanded?: boolean;
}) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [fullJson, setFullJson] = useState(false);

    const toolName = tool.name || tool.tool || 'unknown_tool';
    const isRunning = tool.status === 'running';
    const isError = tool.status === 'error' || tool.status === 'failed';

    const apiCalls: ApiCallTrace[] = (tool.apiCalls && tool.apiCalls.length > 0)
        ? tool.apiCalls
        : (TOOL_FALLBACK_API_MAP[toolName]
            ? [{
                method: TOOL_FALLBACK_API_MAP[toolName].method,
                path: TOOL_FALLBACK_API_MAP[toolName].path,
                status: isError ? 500 : 200,
                durationMs: tool.durationMs
            }]
            : []);

    const formattedOutput = tool.output !== undefined ? JSON.stringify(tool.output, null, 2) : '';
    const isLongOutput = formattedOutput.split('\n').length > 14;

    return (
        <div className={`rounded-xl border transition-all text-xs ${
            isError 
                ? 'bg-red-500/10 border-red-500/30' 
                : isRunning
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-card-secondary/70 border-border'
        }`}>
            <div
                onClick={() => setExpanded(!expanded)}
                className="p-2.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-card-hover/40 rounded-xl flex-wrap"
            >
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <div className={`p-1 rounded-md shrink-0 ${isError ? 'text-red-400' : isRunning ? 'text-blue-400 animate-spin' : 'text-emerald-400'}`}>
                        {isRunning ? <Loader2 size={13} /> : isError ? <XCircle size={13} /> : <Wrench size={13} />}
                    </div>
                    <span className="font-mono font-bold text-text-primary text-[11px]">
                        tool: <span className="text-blue-400">{toolName}</span>
                    </span>
                    {apiCalls.map((api, idx) => (
                        <span
                            key={idx}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-black/30 border border-border/70 font-mono text-[10px]"
                        >
                            <span className={
                                api.method === 'POST'
                                    ? 'text-amber-400 font-black'
                                    : api.method === 'DELETE'
                                        ? 'text-red-400 font-black'
                                        : 'text-cyan-400 font-black'
                            }>
                                {api.method}
                            </span>
                            <span className="text-text-secondary">{api.path}</span>
                            {api.status && (
                                <span className={`px-1 rounded text-[9px] font-bold ${
                                    api.status >= 400
                                        ? 'bg-red-500/20 text-red-300'
                                        : 'bg-emerald-500/20 text-emerald-300'
                                }`}>
                                    {api.status}
                                </span>
                            )}
                        </span>
                    ))}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {tool.durationMs !== undefined && (
                        <span className="text-[10px] font-mono text-text-muted">
                            {tool.durationMs}ms
                        </span>
                    )}
                    <span className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                        isRunning 
                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' 
                            : isError 
                                ? 'bg-red-500/20 text-red-300 border-red-500/30' 
                                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    }`}>
                        {tool.status}
                    </span>
                    {expanded ? <ChevronDown size={14} className="text-text-muted" /> : <ChevronRight size={14} className="text-text-muted" />}
                </div>
            </div>

            {expanded && (
                <div className="p-3 border-t border-border space-y-2.5 bg-black/20 rounded-b-xl text-[11px] font-mono">
                    {/* HTTP API Calls Trace */}
                    {apiCalls.length > 0 && (
                        <div>
                            <div className="text-[9px] text-text-muted uppercase font-sans font-black mb-1">
                                Appel{apiCalls.length > 1 ? 's' : ''} API HTTP :
                            </div>
                            <div className="space-y-1">
                                {apiCalls.map((api, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-center justify-between gap-2 bg-card px-2.5 py-1.5 rounded-lg border border-border/50 text-[11px]"
                                    >
                                        <div className="flex items-center gap-2 overflow-x-auto">
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                                                api.method === 'POST'
                                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                                    : api.method === 'DELETE'
                                                        ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                                                        : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                                            }`}>
                                                {api.method}
                                            </span>
                                            <span className="text-text-primary font-bold">{api.path}</span>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {api.status && (
                                                <span className={`text-[10px] font-bold ${api.status >= 400 ? 'text-red-400' : 'text-emerald-400'}`}>
                                                    HTTP {api.status}
                                                </span>
                                            )}
                                            {api.durationMs !== undefined && (
                                                <span className="text-[10px] text-text-muted">{api.durationMs}ms</span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => onCopy(`${api.method} ${api.path}`)}
                                                className="text-[10px] text-blue-400 hover:underline flex items-center gap-1 font-sans cursor-pointer"
                                                title="Copier l'endpoint API"
                                            >
                                                <Copy size={10} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Input Arguments */}
                    {tool.input && Object.keys(tool.input).length > 0 && (
                        <div>
                            <div className="text-[9px] text-text-muted uppercase font-sans font-black mb-1">Paramètres (Input) :</div>
                            <pre className="bg-card p-2 rounded-lg text-text-secondary overflow-x-auto border border-border/50">
                                {JSON.stringify(tool.input, null, 2)}
                            </pre>
                        </div>
                    )}

                    {/* Output JSON Response */}
                    {tool.output !== undefined && (
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[9px] text-text-muted uppercase font-sans font-black">Réponse API / Outil (JSON) :</span>
                                <div className="flex items-center gap-3 font-sans">
                                    {isLongOutput && (
                                        <button
                                            type="button"
                                            onClick={() => setFullJson(!fullJson)}
                                            className="text-[10px] text-text-secondary hover:text-text-primary hover:underline cursor-pointer"
                                        >
                                            {fullJson ? 'Réduire' : 'Tout afficher'}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onCopy(formattedOutput)}
                                        className="text-[10px] text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                                    >
                                        <Copy size={10} /> Copier JSON
                                    </button>
                                </div>
                            </div>
                            <pre className={`bg-card p-2.5 rounded-lg text-emerald-300/90 overflow-x-auto border border-border/50 custom-scrollbar ${
                                fullJson ? 'max-h-[520px]' : 'max-h-56'
                            }`}>
                                {formattedOutput}
                            </pre>
                        </div>
                    )}

                    {tool.error && (
                        <div className="text-red-400 bg-red-950/40 p-2 rounded-lg border border-red-500/20">
                            Error: {tool.error}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Enhanced Markdown Renderer with Real Tables & Formatting ──
function MarkdownRenderer({ content, onCopy }: { content: string; onCopy: (text: string) => void }) {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // 1. Code Block Delimiters
        if (line.startsWith('```')) {
            const codeLanguage = line.substring(3).trim();
            const codeBuffer: string[] = [];
            i++;
            while (i < lines.length && !lines[i].startsWith('```')) {
                codeBuffer.push(lines[i]);
                i++;
            }
            if (i < lines.length && lines[i].startsWith('```')) {
                i++; // consume closing backticks
            }
            const fullCode = codeBuffer.join('\n');
            elements.push(
                <div key={`code-${i}`} className="my-3 rounded-xl overflow-hidden border border-border bg-black/60 shadow-inner">
                    <div className="bg-card-secondary/80 px-3 py-1.5 flex items-center justify-between border-b border-border text-[10px] font-mono text-text-muted">
                        <span className="font-bold text-indigo-400">{codeLanguage || 'code'}</span>
                        <button
                            onClick={() => onCopy(fullCode)}
                            className="flex items-center gap-1 text-text-secondary hover:text-white transition-all text-[11px]"
                        >
                            <Copy size={12} /> Copy
                        </button>
                    </div>
                    <pre className="p-3 text-[11px] font-mono text-blue-300 overflow-x-auto custom-scrollbar leading-relaxed">
                        <code>{fullCode}</code>
                    </pre>
                </div>
            );
            continue;
        }

        // 2. Table Block (Consecutive lines starting and ending with |)
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
            const tableLines: string[] = [];
            const tableStartIndex = i;
            while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
                tableLines.push(lines[i].trim());
                i++;
            }
            elements.push(renderTableBlock(tableLines, `table-${tableStartIndex}`));
            continue;
        }

        // 3. Horizontal Rules
        if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
            elements.push(<hr key={`hr-${i}`} className="my-3 border-border/80" />);
            i++;
            continue;
        }

        // 4. Headers
        if (line.startsWith('#### ')) {
            elements.push(<h5 key={`h4-${i}`} className="text-xs font-black text-text-primary mt-3 mb-1 uppercase tracking-wider">{parseInlineFormatting(line.substring(5))}</h5>);
            i++;
            continue;
        }
        if (line.startsWith('### ')) {
            elements.push(<h4 key={`h3-${i}`} className="text-xs font-black text-blue-400 mt-3.5 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">{parseInlineFormatting(line.substring(4))}</h4>);
            i++;
            continue;
        }
        if (line.startsWith('## ')) {
            elements.push(<h3 key={`h2-${i}`} className="text-sm font-black text-text-primary mt-4 mb-2 tracking-tight border-b border-border/50 pb-1">{parseInlineFormatting(line.substring(3))}</h3>);
            i++;
            continue;
        }
        if (line.startsWith('# ')) {
            elements.push(<h2 key={`h1-${i}`} className="text-base font-black text-text-primary mt-4 mb-2 tracking-tight border-b border-border pb-1.5">{parseInlineFormatting(line.substring(2))}</h2>);
            i++;
            continue;
        }

        // 5. Numbered Lists (1. Item)
        const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
            elements.push(
                <div key={`num-${i}`} className="flex items-start gap-2.5 ml-1 my-1 text-xs leading-relaxed">
                    <span className="bg-blue-500/10 text-blue-400 border border-blue-500/20 text-[10px] font-black rounded-md w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">
                        {numMatch[1]}
                    </span>
                    <span className="text-text-secondary flex-1">{parseInlineFormatting(numMatch[2])}</span>
                </div>
            );
            i++;
            continue;
        }

        // 6. Bullet Lists (- Item or * Item or • Item)
        if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• ')) {
            const rawItem = line.startsWith('• ') ? line.substring(2) : line.substring(2);
            elements.push(
                <div key={`bullet-${i}`} className="flex items-start gap-2 ml-1.5 my-1 text-xs leading-relaxed">
                    <span className="text-blue-500 font-bold shrink-0 mt-0.5">•</span>
                    <span className="text-text-secondary flex-1">{parseInlineFormatting(rawItem)}</span>
                </div>
            );
            i++;
            continue;
        }

        // 7. Blockquotes / Callouts
        if (line.startsWith('> ')) {
            elements.push(
                <div key={`quote-${i}`} className="border-l-2 border-blue-500 pl-3.5 my-2 text-xs text-text-secondary/90 bg-blue-500/5 py-1.5 rounded-r-xl">
                    {parseInlineFormatting(line.substring(2))}
                </div>
            );
            i++;
            continue;
        }

        // 8. Standard Paragraph or Empty Line
        if (line.trim() === '') {
            elements.push(<div key={`empty-${i}`} className="h-2" />);
        } else {
            elements.push(
                <p key={`p-${i}`} className="my-1.5 text-xs leading-relaxed text-text-secondary">
                    {parseInlineFormatting(line)}
                </p>
            );
        }
        i++;
    }

    return <div className="space-y-0.5 text-xs">{elements}</div>;
}

function renderTableBlock(tableLines: string[], keyPrefix: string): React.ReactNode {
    if (tableLines.length === 0) return null;

    const parseRow = (line: string) => {
        const trimmed = line.trim();
        const content = trimmed.startsWith('|') && trimmed.endsWith('|')
            ? trimmed.slice(1, -1)
            : trimmed;
        return content.split('|').map(cell => cell.trim());
    };

    const headerCells = parseRow(tableLines[0]);
    // Check if second line is markdown table divider (e.g. |---|---|)
    const hasDivider = tableLines.length > 1 && /^[\s|:-]+$/.test(tableLines[1]);
    const rowStartIdx = hasDivider ? 2 : 1;
    const bodyRows = tableLines.slice(rowStartIdx).map(parseRow);

    return (
        <div key={keyPrefix} className="my-3 overflow-x-auto rounded-xl border border-border bg-card/60 shadow-sm">
            <table className="w-full text-left border-collapse text-xs">
                <thead>
                    <tr className="bg-card-secondary/90 border-b border-border text-[10px] font-black uppercase tracking-wider text-text-primary">
                        {headerCells.map((h, i) => (
                            <th key={i} className="px-3.5 py-2.5 font-bold whitespace-nowrap">
                                {parseInlineFormatting(h)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                    {bodyRows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-blue-500/5 transition-colors odd:bg-transparent even:bg-card-secondary/20">
                            {row.map((cell, cIdx) => (
                                <td key={cIdx} className="px-3.5 py-2 text-text-secondary leading-relaxed align-middle">
                                    {parseInlineFormatting(cell)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Inline Markdown Formatter (**bold**, `code`, links, pills) ──
function parseInlineFormatting(text: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*.*?\*\*|`.*?`|\[.*?\]\(.*?\)|\*.*?\*)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.substring(lastIndex, match.index));
        }

        const raw = match[0];
        if (raw.startsWith('**') && raw.endsWith('**')) {
            const inner = raw.slice(2, -2);
            parts.push(<strong key={match.index} className="font-black text-text-primary">{inner}</strong>);
        } else if (raw.startsWith('`') && raw.endsWith('`')) {
            parts.push(<code key={match.index} className="bg-card-secondary px-1.5 py-0.5 rounded text-[11px] font-mono text-indigo-400 border border-border/40">{raw.slice(1, -1)}</code>);
        } else if (raw.startsWith('[') && raw.includes('](') && raw.endsWith(')')) {
            const linkMatch = raw.match(/^\[(.*?)\]\((.*?)\)$/);
            if (linkMatch) {
                parts.push(
                    <a
                        key={match.index}
                        href={linkMatch[2]}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:text-blue-300 underline font-medium inline-flex items-center gap-0.5"
                    >
                        {linkMatch[1]}
                    </a>
                );
            } else {
                parts.push(raw);
            }
        } else if (raw.startsWith('*') && raw.endsWith('*')) {
            parts.push(<em key={match.index} className="italic text-text-secondary">{raw.slice(1, -1)}</em>);
        }

        lastIndex = match.index + raw.length;
    }

    if (lastIndex < text.length) {
        parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
}
