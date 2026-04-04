import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { X, Send, Bot, Loader2, Square, Trash2, Wrench, Plus, ChevronDown, Unplug } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useGraphStore } from '../store/graph-store';
import { useAgentRuntimeStore } from '../store/agent-runtime-store';
import { useSettingsStore } from '../settings/settings-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';
import type { RuntimeEvent } from '../runtime/agent-runtime';
import { useSessionStore, type Message } from '../store/session-store';
import { estimateTokens } from '../runtime/token-estimator';
import { useContextWindow, usePeripheralReservations } from './useContextWindow';
import ContextUsagePanel from './ContextUsagePanel';

interface ChatDrawerProps {
  agentNodeId: string;
  onClose: () => void;
}

function formatTokenBadge(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return count.toString();
}

function formatSessionDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function formatSessionLabel(llmSlug: string, lastMessageAt: number, isDefault: boolean): string {
  // Shorten the llm slug for display
  const parts = llmSlug.split('/');
  const shortSlug = parts.length > 2 ? `${parts[0]}/${parts[parts.length - 1]}` : llmSlug;
  const dateStr = formatSessionDate(lastMessageAt);
  const prefix = isDefault ? '● ' : '';
  return `${prefix}${shortSlug} · ${dateStr}`;
}

export default function ChatDrawer({ agentNodeId, onClose }: ChatDrawerProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const getOrCreateRuntime = useAgentRuntimeStore((s) => s.getOrCreateRuntime);
  const destroyRuntime = useAgentRuntimeStore((s) => s.destroyRuntime);
  const getApiKey = useSettingsStore((s) => s.getApiKey);

  const config = resolveAgentConfig(agentNodeId, nodes, edges);

  // Session store
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionIdMap = useSessionStore((s) => s.activeSessionId);
  const createSession = useSessionStore((s) => s.createSession);
  const deleteSession = useSessionStore((s) => s.deleteSession);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const addMessage = useSessionStore((s) => s.addMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);
  const clearSessionMessages = useSessionStore((s) => s.clearSessionMessages);
  const getSessionsForAgent = useSessionStore((s) => s.getSessionsForAgent);
  const enforceSessionLimit = useSessionStore((s) => s.enforceSessionLimit);

  // Find the agent node to get name
  const agentNode = nodes.find((n) => n.id === agentNodeId && n.data.type === 'agent');
  const agentName =
    agentNode?.data.type === 'agent' ? (agentNode.data as { name: string }).name : '';

  // Get sessions for this agent
  const agentSessions = useMemo(
    () => getSessionsForAgent(agentName),
    [sessions, agentName, getSessionsForAgent],
  );

  // Active session ID
  const activeSessionId = activeSessionIdMap[agentNodeId] ?? null;
  const activeSession = activeSessionId ? sessions[activeSessionId] : null;
  const messages = activeSession?.messages ?? [];

  // Auto-create default session if none exists
  useEffect(() => {
    if (!config || !agentName) return;

    if (agentSessions.length === 0) {
      // No sessions at all — create default
      const id = createSession(agentName, config.provider, config.modelId, true);
      setActiveSession(agentNodeId, id);
    } else if (!activeSessionId || !sessions[activeSessionId]) {
      // No active session or active session was deleted — pick the most recent
      setActiveSession(agentNodeId, agentSessions[0].id);
    }
  }, [agentName, config, agentSessions.length, activeSessionId]);

  // UI state
  const [showSessionDropdown, setShowSessionDropdown] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Context window and peripheral reservations
  const contextInfo = useContextWindow(config);
  const peripheralReservations = usePeripheralReservations(config);

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Cleanup runtime subscription on unmount
  useEffect(() => {
    return () => {
      unsubRef.current?.();
    };
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showSessionDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSessionDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSessionDropdown]);

  const handleNewSession = () => {
    if (!config || !agentName) return;

    // Enforce limit before creating
    enforceSessionLimit(agentName, 3);

    // Check if we're at the limit after enforcement
    const currentSessions = getSessionsForAgent(agentName);
    if (currentSessions.length >= 3) {
      // Drop the oldest
      const oldest = currentSessions[currentSessions.length - 1];
      if (oldest.id.endsWith(':default')) {
        // Don't delete default if it's the only one — delete second oldest
        if (currentSessions.length > 1) {
          deleteSession(currentSessions[currentSessions.length - 1].id);
        }
      } else {
        deleteSession(oldest.id);
      }
    }

    const id = createSession(agentName, config.provider, config.modelId, false);
    setActiveSession(agentNodeId, id);
    setShowSessionDropdown(false);

    // Destroy current runtime so a fresh one is used for the new session
    destroyRuntime(agentNodeId);
  };

  const handleDeleteSession = (sessionId: string) => {
    if (deleteConfirmId === sessionId) {
      deleteSession(sessionId);
      setDeleteConfirmId(null);

      // If we deleted the active session, switch to another
      if (activeSessionId === sessionId) {
        const remaining = getSessionsForAgent(agentName);
        if (remaining.length > 0) {
          setActiveSession(agentNodeId, remaining[0].id);
        } else if (config) {
          // Create a new default session
          const id = createSession(agentName, config.provider, config.modelId, true);
          setActiveSession(agentNodeId, id);
        }
      }
    } else {
      setDeleteConfirmId(sessionId);
    }
  };

  const handleSwitchSession = (sessionId: string) => {
    setActiveSession(agentNodeId, sessionId);
    setShowSessionDropdown(false);
    // Destroy runtime so it rebuilds with the new session's context
    destroyRuntime(agentNodeId);
  };

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming || !config || !activeSessionId) return;

    const trimmedInput = input.trim();
    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
      tokenCount: estimateTokens(trimmedInput),
    };

    addMessage(activeSessionId, userMessage);
    setInput('');
    setIsStreaming(true);

    try {
      const runtime = getOrCreateRuntime(agentNodeId, config, (provider) =>
        Promise.resolve(getApiKey(provider)),
      );

      const assistantMessageId = `msg_${Date.now()}_a`;
      let assistantContent = '';

      unsubRef.current?.();

      const unsub = runtime.subscribe((event: RuntimeEvent) => {
        if (event.type === 'message_start') {
          const msg = event.message as { role?: string };
          if (msg.role === 'assistant') {
            assistantContent = '';
            addMessage(activeSessionId, {
              id: assistantMessageId,
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
            });
          }
        } else if (event.type === 'message_update') {
          const aEvent = event.assistantMessageEvent;
          if (aEvent.type === 'text_delta') {
            assistantContent += aEvent.delta;
            updateMessage(activeSessionId, assistantMessageId, (m) => ({
              ...m,
              content: assistantContent,
            }));
          } else if (aEvent.type === 'error') {
            console.error('[pi-ai Error]', aEvent);
            addMessage(activeSessionId, {
              id: `err_${Date.now()}`,
              role: 'assistant',
              content: `API Error: ${aEvent.error?.errorMessage || 'Unknown provider error'}`,
              timestamp: Date.now(),
            });
            setIsStreaming(false);
          }
        } else if (event.type === 'message_end') {
          const endMsg = event.message as {
            role?: string;
            usage?: {
              input: number;
              output: number;
              cacheRead: number;
              cacheWrite: number;
              totalTokens: number;
            };
            content?: Array<{ type: string; text?: string }>;
          };
          if (endMsg.role === 'assistant' && endMsg.usage) {
            updateMessage(activeSessionId, assistantMessageId, (m) => ({
              ...m,
              tokenCount: endMsg.usage!.output,
              usage: {
                input: endMsg.usage!.input,
                output: endMsg.usage!.output,
                cacheRead: endMsg.usage!.cacheRead,
                cacheWrite: endMsg.usage!.cacheWrite,
                totalTokens: endMsg.usage!.totalTokens,
              },
            }));
          }
        } else if (event.type === 'tool_execution_start') {
          addMessage(activeSessionId, {
            id: `tool_${event.toolCallId}`,
            role: 'tool',
            content: `Calling tool: ${event.toolName}`,
            timestamp: Date.now(),
          });
        } else if (event.type === 'tool_execution_end') {
          const resultText =
            event.result?.content
              ?.map((c: { type: string; text?: string }) =>
                c.type === 'text' ? c.text : '',
              )
              .join('') || '';
          const toolContent = `${event.toolName}: ${resultText.slice(0, 500)}${event.isError ? ' (error)' : ''}`;
          updateMessage(activeSessionId, `tool_${event.toolCallId}`, (m) => ({
            ...m,
            content: toolContent,
            tokenCount: estimateTokens(toolContent),
          }));
        } else if (event.type === 'agent_end') {
          setIsStreaming(false);
        } else if (event.type === 'runtime_error') {
          addMessage(activeSessionId, {
            id: `err_${Date.now()}`,
            role: 'assistant',
            content: `Error: ${event.error}`,
            timestamp: Date.now(),
          });
          setIsStreaming(false);
        }
      });

      unsubRef.current = unsub;

      await runtime.prompt(userMessage.content);
    } catch (error) {
      addMessage(activeSessionId, {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}. Make sure you have configured your API keys in Settings.`,
        timestamp: Date.now(),
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, config, agentNodeId, activeSessionId, getOrCreateRuntime, getApiKey]);

  const handleStop = () => {
    if (!config) return;
    try {
      const runtime = getOrCreateRuntime(agentNodeId, config, (provider) =>
        Promise.resolve(getApiKey(provider)),
      );
      runtime.abort();
      setIsStreaming(false);
    } catch (e) {
      console.error('Failed to abort agent', e);
    }
  };

  const handleClose = () => {
    destroyRuntime(agentNodeId);
    onClose();
  };

  // Determine what's missing for the overlay message
  const missingPeripherals = useMemo(() => {
    if (!config) return [];
    const missing: { key: string; label: string; description: string; hint: string }[] = [];

    if (!config.contextEngine) {
      missing.push({
        key: 'contextEngine',
        label: 'Context Engine Required',
        description:
          'A Context Engine manages the conversation\'s token budget, compaction strategy, and memory window. Without it, the agent cannot track how much context is available, when to summarize or trim history, or how to allocate space for tools and system prompts.',
        hint: 'Drag a Context Engine node onto the canvas and connect it to this agent to enable chat.',
      });
    }

    if (!config.tools) {
      missing.push({
        key: 'tools',
        label: 'Tools Node Required',
        description:
          'A Tools node defines which tools the agent can use, including built-in tool groups, custom skills, and plugins.',
        hint: 'Drag a Tools node onto the canvas and connect it to this agent.',
      });
    }

    return missing;
  }, [config]);

  const isBlocked = missingPeripherals.length > 0;

  if (!config) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l border-slate-700 bg-slate-900 shadow-2xl relative">
      {/* Header */}
      <div className="flex flex-col border-b border-slate-800">
        {/* Top row: agent name + controls */}
        <div className="flex items-center gap-3 px-4 py-3">
          <Bot size={18} className="text-blue-400" />
          <div className="flex-1">
            <h3 className="text-sm font-bold text-slate-100">{config.name}</h3>
            <p className="text-[10px] text-slate-500">
              {config.provider} / {config.modelId}
            </p>
          </div>
          {isStreaming && (
            <Loader2 size={14} className="animate-spin text-blue-400" />
          )}
          {messages.length > 0 && (
            <button
              onClick={() => activeSessionId && clearSessionMessages(activeSessionId)}
              className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-red-400"
              title="Clear Messages"
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            onClick={handleClose}
            className="relative z-20 rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
          >
            <X size={16} />
          </button>
        </div>

        {/* Session selector row */}
        <div className="flex items-center gap-1.5 border-t border-slate-800/50 px-4 py-1.5">
          <span className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold">
            Session
          </span>
          <div className="relative flex-1" ref={dropdownRef}>
            <button
              onClick={() => setShowSessionDropdown(!showSessionDropdown)}
              className="flex w-full items-center justify-between gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] text-slate-300 transition hover:border-slate-600"
            >
              <span className="truncate">
                {activeSession
                  ? formatSessionLabel(
                      activeSession.llmSlug,
                      activeSession.lastMessageAt,
                      activeSession.id.endsWith(':default'),
                    )
                  : 'No session'}
              </span>
              <ChevronDown size={10} className="flex-shrink-0 text-slate-500" />
            </button>

            {/* Dropdown */}
            {showSessionDropdown && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border border-slate-700 bg-slate-850 shadow-xl overflow-hidden"
                   style={{ backgroundColor: '#1a2332' }}>
                {agentSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] cursor-pointer transition ${
                      session.id === activeSessionId
                        ? 'bg-blue-500/10 text-blue-300'
                        : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                    }`}
                  >
                    <button
                      className="flex-1 text-left truncate"
                      onClick={() => handleSwitchSession(session.id)}
                    >
                      {formatSessionLabel(
                        session.llmSlug,
                        session.lastMessageAt,
                        session.id.endsWith(':default'),
                      )}
                      <span className="ml-1 text-[8px] text-slate-600">
                        ({session.messages.length} msgs)
                      </span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(session.id);
                      }}
                      className={`flex-shrink-0 rounded p-0.5 transition ${
                        deleteConfirmId === session.id
                          ? 'bg-red-500/20 text-red-400'
                          : 'text-slate-600 hover:text-red-400'
                      }`}
                      title={
                        deleteConfirmId === session.id
                          ? 'Click again to confirm'
                          : 'Delete session'
                      }
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))}
                {agentSessions.length === 0 && (
                  <div className="px-2.5 py-2 text-[10px] text-slate-600 italic">
                    No sessions
                  </div>
                )}
              </div>
            )}
          </div>

          {/* New session button */}
          <button
            onClick={handleNewSession}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-blue-400"
            title="New Session"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Missing Peripherals Overlay */}
      {isBlocked && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-slate-900/80 backdrop-blur-sm px-8">
          <div className="rounded-full bg-amber-500/10 p-4">
            <Unplug size={32} className="text-amber-400" />
          </div>
          {missingPeripherals.map((p) => (
            <div key={p.key} className="flex flex-col items-center gap-1.5">
              <h4 className="text-sm font-semibold text-slate-100 text-center">
                {p.label}
              </h4>
              <p className="text-xs text-slate-400 text-center leading-relaxed max-w-[280px]">
                {p.description}
              </p>
              <p className="text-[10px] text-slate-500 text-center max-w-[260px]">
                {p.hint}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className={`flex-1 overflow-y-auto p-4 space-y-3 ${isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}`}>
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-slate-600">
              Send a message to start the conversation
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className="max-w-[85%]">
              <div
                className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : msg.role === 'tool'
                      ? 'border border-slate-700 bg-slate-800/50 text-slate-400 italic'
                      : 'bg-slate-800 text-slate-200'
                }`}
              >
                {msg.role === 'assistant' ? (
                  <div className="prose-sm max-w-none text-slate-200 break-words">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: (props: any) => { const {node, ...rest} = props; return <p className="mb-2 last:mb-0 leading-relaxed" {...rest} /> },
                        a: (props: any) => { const {node, ...rest} = props; return <a className="text-blue-400 hover:text-blue-300 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...rest} /> },
                        ul: (props: any) => { const {node, ...rest} = props; return <ul className="list-disc pl-4 mb-2 space-y-1" {...rest} /> },
                        ol: (props: any) => { const {node, ...rest} = props; return <ol className="list-decimal pl-4 mb-2 space-y-1" {...rest} /> },
                        li: (props: any) => { const {node, ...rest} = props; return <li className="marker:text-slate-500" {...rest} /> },
                        h1: (props: any) => { const {node, ...rest} = props; return <h1 className="text-lg font-bold mt-4 mb-2 text-slate-100" {...rest} /> },
                        h2: (props: any) => { const {node, ...rest} = props; return <h2 className="text-base font-bold mt-4 mb-2 text-slate-100 border-b border-slate-700/50 pb-1" {...rest} /> },
                        h3: (props: any) => { const {node, ...rest} = props; return <h3 className="text-sm font-bold mt-3 mb-1 text-slate-200" {...rest} /> },
                        table: (props: any) => { const {node, ...rest} = props; return <div className="overflow-x-auto my-3"><table className="w-full text-left border-collapse" {...rest} /></div> },
                        th: (props: any) => { const {node, ...rest} = props; return <th className="border border-slate-700 bg-slate-900/50 px-3 py-2 font-semibold text-slate-100" {...rest} /> },
                        td: (props: any) => { const {node, ...rest} = props; return <td className="border border-slate-700 px-3 py-2 text-slate-300" {...rest} /> },
                        blockquote: (props: any) => { const {node, ...rest} = props; return <blockquote className="border-l-4 border-blue-500/50 bg-slate-900/30 pl-3 py-1 pr-2 my-2 italic text-slate-400 rounded-r" {...rest} /> },
                        code(props: any) {
                          const {children, className, node, ...rest} = props;
                          const match = /language-(\w+)/.exec(className || '');
                          return match ? (
                            <div className="rounded-md bg-[#0d1117] border border-slate-700/60 my-3 overflow-hidden shadow-sm">
                              <div className="bg-slate-800/80 px-3 py-1.5 text-[10px] text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-700/60">
                                {match[1]}
                              </div>
                              <pre className="p-3 overflow-x-auto text-[11px] font-mono text-slate-300 leading-normal">
                                <code className={className} {...rest}>
                                  {children}
                                </code>
                              </pre>
                            </div>
                          ) : (
                            <code className="bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700/50 text-slate-300 font-mono text-[11px]" {...rest}>
                              {children}
                            </code>
                          );
                        }
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap font-sans break-words">{msg.content}</pre>
                )}
                {msg.role === 'assistant' && !msg.content && isStreaming && (
                  <span className="inline-block h-3 w-1 animate-pulse bg-slate-400" />
                )}
              </div>
              {/* Token badge */}
              {msg.tokenCount != null && msg.tokenCount > 0 && (
                <div className={`flex items-center gap-1 mt-0.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'tool' && <Wrench size={8} className="text-slate-600" />}
                  <span className="text-[8px] tabular-nums text-slate-600 font-mono">
                    {formatTokenBadge(msg.tokenCount)} tokens
                  </span>
                  {msg.usage && (
                    <span className="text-[8px] text-slate-600 font-mono">
                      (in:{formatTokenBadge(msg.usage.input)} out:{formatTokenBadge(msg.usage.output)})
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Context Usage Panel — above input */}
      <div className={isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}>
        <ContextUsagePanel
          messages={messages}
          contextInfo={contextInfo}
          peripheralReservations={peripheralReservations}
        />
      </div>

      {/* Input */}
      <div className={`border-t border-slate-800 p-3 ${isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}`}>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Type a message..."
            disabled={isStreaming || isBlocked}
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="rounded-lg bg-red-600 p-2 text-white transition hover:bg-red-500"
              title="Stop Agent"
            >
              <Square fill="currentColor" size={14} />
            </button>
          ) : (
            <button
              onClick={sendMessage}
              disabled={!input.trim() || isBlocked}
              className="rounded-lg bg-blue-600 p-2 text-white transition hover:bg-blue-500 disabled:opacity-50"
              title="Send Message"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
