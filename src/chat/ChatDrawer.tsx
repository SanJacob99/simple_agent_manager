import { useRef, useEffect, useState, useCallback } from 'react';
import { X, Send, Bot, Loader2, Square, Trash2, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useGraphStore } from '../store/graph-store';
import { useAgentRuntimeStore } from '../store/agent-runtime-store';
import { useSettingsStore } from '../settings/settings-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';
import type { RuntimeEvent } from '../runtime/agent-runtime';
import { useChatStore, type Message } from '../store/chat-store';
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

export default function ChatDrawer({ agentNodeId, onClose }: ChatDrawerProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const getOrCreateRuntime = useAgentRuntimeStore((s) => s.getOrCreateRuntime);
  const destroyRuntime = useAgentRuntimeStore((s) => s.destroyRuntime);
  const getApiKey = useSettingsStore((s) => s.getApiKey);

  const config = resolveAgentConfig(agentNodeId, nodes, edges);

  const messages = useChatStore((s) => s.chats[agentNodeId]) || [];
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const clearChat = useChatStore((s) => s.clearChat);

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

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming || !config) return;

    const trimmedInput = input.trim();
    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
      tokenCount: estimateTokens(trimmedInput), // estimate tokens for user message
    };

    addMessage(agentNodeId, userMessage);
    setInput('');
    setIsStreaming(true);

    try {
      const runtime = getOrCreateRuntime(agentNodeId, config, (provider) =>
        Promise.resolve(getApiKey(provider)),
      );

      // Set up event listener for this prompt
      const assistantMessageId = `msg_${Date.now()}_a`;
      let assistantContent = '';

      // Unsubscribe previous listener
      unsubRef.current?.();

      const unsub = runtime.subscribe((event: RuntimeEvent) => {
        if (event.type === 'message_start') {
          const msg = event.message as { role?: string };
          if (msg.role === 'assistant') {
            assistantContent = '';
            addMessage(agentNodeId, { id: assistantMessageId, role: 'assistant', content: '', timestamp: Date.now() });
          }
        } else if (event.type === 'message_update') {
          const aEvent = event.assistantMessageEvent;
          if (aEvent.type === 'text_delta') {
            assistantContent += aEvent.delta;
            updateMessage(agentNodeId, assistantMessageId, (m) => ({ ...m, content: assistantContent }));
          } else if (aEvent.type === 'error') {
            console.error('[pi-ai Error]', aEvent);
            addMessage(agentNodeId, {
              id: `err_${Date.now()}`,
              role: 'assistant',
              content: `API Error: ${aEvent.error?.errorMessage || 'Unknown provider error'}`,
              timestamp: Date.now(),
            });
            setIsStreaming(false);
          }
        } else if (event.type === 'message_end') {
          // Capture real usage data from the API response
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
            updateMessage(agentNodeId, assistantMessageId, (m) => ({
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
          addMessage(agentNodeId, {
            id: `tool_${event.toolCallId}`,
            role: 'tool',
            content: `Calling tool: ${event.toolName}`,
            timestamp: Date.now(),
          });
        } else if (event.type === 'tool_execution_end') {
          const resultText = event.result?.content
            ?.map((c: { type: string; text?: string }) =>
              c.type === 'text' ? c.text : '',
            )
            .join('') || '';
          const toolContent = `${event.toolName}: ${resultText.slice(0, 500)}${event.isError ? ' (error)' : ''}`;
          updateMessage(agentNodeId, `tool_${event.toolCallId}`, (m) => ({
            ...m,
            content: toolContent,
            tokenCount: estimateTokens(toolContent),
          }));
        } else if (event.type === 'agent_end') {
          setIsStreaming(false);
        } else if (event.type === 'runtime_error') {
          addMessage(agentNodeId, {
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
      addMessage(agentNodeId, {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}. Make sure you have configured your API keys in Settings.`,
        timestamp: Date.now(),
      });
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, config, agentNodeId, getOrCreateRuntime, getApiKey]);

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

  if (!config) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l border-slate-700 bg-slate-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
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
            onClick={() => clearChat(agentNodeId)}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-red-400"
            title="Clear Chat"
          >
            <Trash2 size={16} />
          </button>
        )}
        <button
          onClick={handleClose}
          className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                    {msg.role === 'tool' ? '' : ''}{formatTokenBadge(msg.tokenCount)} tokens
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
      <ContextUsagePanel
        messages={messages}
        contextInfo={contextInfo}
        peripheralReservations={peripheralReservations}
      />

      {/* Input */}
      <div className="border-t border-slate-800 p-3">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Type a message..."
            disabled={isStreaming}
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
              disabled={!input.trim()}
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
