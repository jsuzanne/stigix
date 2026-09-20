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
    Loader2
} from 'lucide-react';
import toast from 'react-hot-toast';

interface CopilotToolCall {
    id: string;
    name: string;
    input: any;
    output?: any;
    status: 'running' | 'completed' | 'error';
    error?: string;
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
    keyMasked: string;
    defaultModel: string;
    requireConfirmation: boolean;
    models: Array<{ id: string; name: string; description: string }>;
}

interface CopilotProps {
    token: string;
    onOpenSettings?: () => void;
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

export default function Copilot({ token, onOpenSettings }: CopilotProps) {
    const [config, setConfig] = useState<AiPublicConfig | null>(null);
    const [sessions, setSessions] = useState<CopilotSession[]>([]);
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
    const [messages, setMessages] = useState<CopilotMessage[]>([]);
    const [inputPrompt, setInputPrompt] = useState('');
    const [selectedModel, setSelectedModel] = useState('claude-3-5-sonnet-20241022');
    const [isStreaming, setIsStreaming] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [showKeyModal, setShowKeyModal] = useState(false);
    const [newApiKey, setNewApiKey] = useState('');
    const [isTestingKey, setIsTestingKey] = useState(false);
    const [isSavingKey, setIsSavingKey] = useState(false);

    const chatEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
                if (cfg.defaultModel) {
                    setSelectedModel(cfg.defaultModel);
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
        setCurrentSessionId(sessionId);
        try {
            const res = await fetch(`/api/copilot/sessions/${sessionId}`, { headers: authHeaders });
            if (res.ok) {
                const data = await res.json();
                const session: CopilotSession = data.session || data;
                setMessages(session.messages || []);
                if (session.model) setSelectedModel(session.model);
            }
        } catch (e: any) {
            console.error('Failed to load session:', e);
        }
    };

    const createNewSession = async () => {
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
        if (!newApiKey.trim()) return;
        setIsSavingKey(true);
        try {
            const res = await fetch('/api/copilot/config', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({ apiKey: newApiKey.trim() })
            });
            if (res.ok) {
                const data = await res.json();
                const updated: AiPublicConfig = data.config || data;
                setConfig(updated);
                setShowKeyModal(false);
                setNewApiKey('');
                toast.success('Anthropic API key saved securely');
            } else {
                toast.error('Failed to save API key');
            }
        } catch (e: any) {
            toast.error(e.message || 'Error saving API key');
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
                body: JSON.stringify({ apiKey: newApiKey.trim() })
            });
            const data = await res.json();
            if (data.success || data.valid) {
                toast.success('API Key validated successfully with Anthropic!');
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

        setMessages(prev => [...prev, userMsg, assistantMsg]);
        setInputPrompt('');
        setIsStreaming(true);

        try {
            const res = await fetch('/api/copilot/chat', {
                method: 'POST',
                headers: authHeaders,
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
            toast.error(e.message || 'Error interacting with AI Copilot');
            setMessages(prev => prev.map(m => {
                if (m.id === assistantMsgId) {
                    return { ...m, content: m.content + `\n\n> ⚠️ **Failed to complete response:** ${e.message}` };
                }
                return m;
            }));
        } finally {
            setIsStreaming(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        toast.success('Copied to clipboard');
    };

    return (
        <div className="flex flex-col lg:flex-row h-[calc(100vh-140px)] min-h-[600px] bg-card border border-border rounded-2xl overflow-hidden shadow-2xl relative">
            {/* ── Sessions Sidebar ── */}
            <div className={`w-full lg:w-72 bg-card-secondary/40 border-r border-border flex flex-col transition-all duration-300 ${sidebarOpen ? 'flex' : 'hidden lg:flex'}`}>
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
                                <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">Anthropic BYOK</span>
                                <span className="text-xs font-mono text-text-secondary truncate max-w-[120px]">
                                    {config?.hasKey ? config.keyMasked : 'No API Key'}
                                </span>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowKeyModal(true)}
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
                <div className="px-6 py-3 border-b border-border bg-card/80 backdrop-blur flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl text-white shadow-md">
                            <Sparkles size={18} />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h1 className="text-sm font-black tracking-tight text-text-primary">Stigix AI Copilot</h1>
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                    BYOK Claude
                                </span>
                            </div>
                            <p className="text-[10px] text-text-muted font-bold">Local SD-WAN & SASE Orchestrator</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Model Selector */}
                        <div className="flex items-center gap-2 bg-card-secondary/60 border border-border px-3 py-1.5 rounded-xl">
                            <Cpu size={14} className="text-indigo-400" />
                            <select
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                className="bg-transparent text-xs font-bold text-text-primary focus:outline-none cursor-pointer"
                            >
                                <option value="claude-3-7-sonnet-20250219" className="bg-card text-text-primary">Claude 3.7 Sonnet (Latest & Smartest)</option>
                                <option value="claude-3-5-sonnet-20241022" className="bg-card text-text-primary">Claude 3.5 Sonnet (Recommended)</option>
                                <option value="claude-3-5-haiku-20241022" className="bg-card text-text-primary">Claude 3.5 Haiku (Fast)</option>
                                <option value="claude-3-opus-20240229" className="bg-card text-text-primary">Claude 3 Opus (Complex reasoning)</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* Chat Feed */}
                <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 custom-scrollbar">
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

                            <div className={`flex flex-col max-w-[85%] sm:max-w-[80%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                                <div
                                    className={`rounded-2xl p-4 sm:p-5 text-xs leading-relaxed shadow-sm ${
                                        m.role === 'user'
                                            ? 'bg-blue-600 text-white rounded-tr-sm font-medium'
                                            : 'bg-card-secondary/50 border border-border text-text-primary rounded-tl-sm w-full'
                                    }`}
                                >
                                    {/* Tool Calls Execution Cards */}
                                    {m.toolCalls && m.toolCalls.length > 0 && (
                                        <div className="mb-4 space-y-2">
                                            {m.toolCalls.map(tool => (
                                                <ToolCallCard key={tool.id} tool={tool} onCopy={copyToClipboard} />
                                            ))}
                                        </div>
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

                                <div className="flex items-center gap-2 text-[10px] text-text-muted mt-1 px-1">
                                    <span>{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    {m.model && (
                                        <>
                                            <span>•</span>
                                            <span className="font-mono">{m.model}</span>
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
                            placeholder={config?.hasKey ? "Ask Stigix Copilot anything or trigger network actions... (Enter to send, Shift+Enter for newline)" : "Please enter your Anthropic API Key above to start chat..."}
                            disabled={!config?.hasKey || isStreaming}
                            rows={1}
                            className="w-full bg-transparent text-xs text-text-primary placeholder:text-text-muted/60 p-3.5 pr-24 focus:outline-none resize-none max-h-40 custom-scrollbar disabled:opacity-50"
                        />

                        <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
                            <button
                                type="submit"
                                disabled={!config?.hasKey || !inputPrompt.trim() || isStreaming}
                                className="p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-card-hover disabled:text-text-muted text-white rounded-xl transition-all shadow-md active:scale-95 flex items-center justify-center"
                                title="Send Message"
                            >
                                {isStreaming ? (
                                    <Loader2 size={16} className="animate-spin text-white" />
                                ) : (
                                    <Send size={16} />
                                )}
                            </button>
                        </div>
                    </form>
                    <div className="flex items-center justify-between text-[10px] text-text-muted mt-2 px-1">
                        <span>Anthropic Claude API (BYOK) • Local Tool Execution • Zero Log Sharing</span>
                        <span>Shift + Enter for new line</span>
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
                                    <h3 className="text-base font-black text-text-primary tracking-tight">Anthropic API Key (BYOK)</h3>
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

                        <div className="space-y-3">
                            <p className="text-xs text-text-secondary leading-relaxed">
                                Enter your Claude API key from Anthropic Console (<code className="bg-card-secondary px-1.5 py-0.5 rounded text-blue-400 font-mono">sk-ant-api03-...</code>).
                                The key is stored locally in <code className="bg-card-secondary px-1 py-0.5 rounded text-text-primary font-mono text-[10px]">config/ai-config.json</code> (chmod 600) and is never transmitted to any third party.
                            </p>

                            <div className="relative">
                                <input
                                    type="password"
                                    value={newApiKey}
                                    onChange={(e) => setNewApiKey(e.target.value)}
                                    placeholder="sk-ant-api03-..."
                                    className="w-full bg-card-secondary border border-border focus:border-blue-500 rounded-xl px-4 py-2.5 text-xs font-mono text-text-primary focus:outline-none shadow-inner"
                                />
                            </div>

                            <div className="flex items-center gap-2 pt-2">
                                <a
                                    href="https://console.anthropic.com/settings/keys"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[11px] text-blue-400 hover:underline flex items-center gap-1 font-bold"
                                >
                                    <span>Get an API Key from Anthropic Console</span>
                                    <ExternalLink size={12} />
                                </a>
                            </div>
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
                                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
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

// ── Tool Call Card Component ──
function ToolCallCard({ tool, onCopy }: { tool: CopilotToolCall; onCopy: (text: string) => void }) {
    const [expanded, setExpanded] = useState(false);

    const isRunning = tool.status === 'running';
    const isError = tool.status === 'error' || (tool as any).status === 'failed';

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
                className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-card-hover/40 rounded-xl"
            >
                <div className="flex items-center gap-2">
                    <div className={`p-1 rounded-md ${isError ? 'text-red-400' : isRunning ? 'text-blue-400 animate-spin' : 'text-emerald-400'}`}>
                        {isRunning ? <Loader2 size={13} /> : isError ? <XCircle size={13} /> : <Wrench size={13} />}
                    </div>
                    <span className="font-mono font-bold text-text-primary text-[11px]">
                        tool: <span className="text-blue-400">{tool.name || (tool as any).tool}</span>
                    </span>
                </div>

                <div className="flex items-center gap-2">
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
                <div className="p-3 border-t border-border space-y-2 bg-black/20 rounded-b-xl text-[11px] font-mono">
                    {tool.input && Object.keys(tool.input).length > 0 && (
                        <div>
                            <div className="text-[9px] text-text-muted uppercase font-sans font-black mb-1">Arguments:</div>
                            <pre className="bg-card p-2 rounded-lg text-text-secondary overflow-x-auto border border-border/50">
                                {JSON.stringify(tool.input, null, 2)}
                            </pre>
                        </div>
                    )}

                    {tool.output && (
                        <div>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[9px] text-text-muted uppercase font-sans font-black">Output Result:</span>
                                <button
                                    onClick={() => onCopy(JSON.stringify(tool.output, null, 2))}
                                    className="text-[10px] text-blue-400 hover:underline flex items-center gap-1 font-sans"
                                >
                                    <Copy size={10} /> Copy
                                </button>
                            </div>
                            <pre className="bg-card p-2 rounded-lg text-emerald-300/90 overflow-x-auto max-h-48 border border-border/50 custom-scrollbar">
                                {JSON.stringify(tool.output, null, 2)}
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

// ── Lightweight Markdown Renderer ──
function MarkdownRenderer({ content, onCopy }: { content: string; onCopy: (text: string) => void }) {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeBuffer: string[] = [];

    lines.forEach((line, index) => {
        // Code Block Delimiters
        if (line.startsWith('```')) {
            if (inCodeBlock) {
                // Close block
                const fullCode = codeBuffer.join('\n');
                elements.push(
                    <div key={`code-${index}`} className="my-3 rounded-xl overflow-hidden border border-border bg-black/50 shadow-inner">
                        <div className="bg-card-secondary/80 px-3 py-1.5 flex items-center justify-between border-b border-border text-[10px] font-mono text-text-muted">
                            <span>{codeLanguage || 'text'}</span>
                            <button
                                onClick={() => onCopy(fullCode)}
                                className="flex items-center gap-1 text-text-secondary hover:text-white transition-all"
                            >
                                <Copy size={11} /> Copy
                            </button>
                        </div>
                        <pre className="p-3 text-[11px] font-mono text-blue-300 overflow-x-auto custom-scrollbar">
                            <code>{fullCode}</code>
                        </pre>
                    </div>
                );
                codeBuffer = [];
                inCodeBlock = false;
                codeLanguage = '';
            } else {
                inCodeBlock = true;
                codeLanguage = line.substring(3).trim();
            }
            return;
        }

        if (inCodeBlock) {
            codeBuffer.push(line);
            return;
        }

        // Headers
        if (line.startsWith('### ')) {
            elements.push(<h4 key={index} className="text-xs font-black text-text-primary mt-3 mb-1 uppercase tracking-wider">{line.substring(4)}</h4>);
            return;
        }
        if (line.startsWith('## ')) {
            elements.push(<h3 key={index} className="text-sm font-black text-text-primary mt-4 mb-2 tracking-tight">{line.substring(3)}</h3>);
            return;
        }
        if (line.startsWith('# ')) {
            elements.push(<h2 key={index} className="text-base font-black text-text-primary mt-4 mb-2 tracking-tight">{line.substring(2)}</h2>);
            return;
        }

        // Bullet lists
        if (line.startsWith('- ') || line.startsWith('* ')) {
            elements.push(
                <div key={index} className="flex items-start gap-2 ml-2 my-1 text-xs">
                    <span className="text-blue-500 font-bold shrink-0">•</span>
                    <span className="text-text-secondary">{parseInlineFormatting(line.substring(2))}</span>
                </div>
            );
            return;
        }

        // Blockquotes
        if (line.startsWith('> ')) {
            elements.push(
                <div key={index} className="border-l-2 border-blue-500 pl-3 my-2 text-xs italic text-text-secondary/90 bg-blue-500/5 py-1 rounded-r-lg">
                    {parseInlineFormatting(line.substring(2))}
                </div>
            );
            return;
        }

        // Tables (simple line detection)
        if (line.startsWith('|') && line.endsWith('|')) {
            elements.push(
                <div key={index} className="font-mono text-[11px] overflow-x-auto py-0.5 text-text-secondary">
                    {line}
                </div>
            );
            return;
        }

        // Standard Paragraph
        if (line.trim() === '') {
            elements.push(<div key={index} className="h-2" />);
        } else {
            elements.push(
                <p key={index} className="my-1 text-xs leading-relaxed text-text-secondary">
                    {parseInlineFormatting(line)}
                </p>
            );
        }
    });

    return <div className="space-y-0.5">{elements}</div>;
}

// ── Inline Markdown Formatter (**bold**, `code`, links) ──
function parseInlineFormatting(text: string): React.ReactNode {
    const parts: React.ReactNode[] = [];
    const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.substring(lastIndex, match.index));
        }

        const raw = match[0];
        if (raw.startsWith('**') && raw.endsWith('**')) {
            parts.push(<strong key={match.index} className="font-black text-text-primary">{raw.slice(2, -2)}</strong>);
        } else if (raw.startsWith('`') && raw.endsWith('`')) {
            parts.push(<code key={match.index} className="bg-card-secondary px-1.5 py-0.5 rounded text-[11px] font-mono text-indigo-400 border border-border/40">{raw.slice(1, -1)}</code>);
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
