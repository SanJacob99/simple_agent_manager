import { useRef, useEffect, useState, useCallback } from 'react';
import { X, Send, Bot, Loader2 } from 'lucide-react';
import { useGraphStore } from '../store/graph-store';
import { useAgentRuntimeStore } from '../store/agent-runtime-store';
import { useSettingsStore } from '../settings/settings-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';
import type { RuntimeEvent } from '../runtime/agent-runtime';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
}

interface ChatDrawerProps {
  agentNodeId: string;
  onClose: () => void;
}

export default function ChatDrawer({ agentNodeId, onClose }: ChatDrawerProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const getOrCreateRuntime = useAgentRuntimeStore((s) => s.getOrCreateRuntime);
  const destroyRuntime = useAgentRuntimeStore((s) => s.destroyRuntime);
  const getApiKey = useSettingsStore((s) => s.getApiKey);

  const config = resolveAgentConfig(agentNodeId, nodes, edges);

  const [messages, setMessages] = useState<Message[]>([]);
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

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
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
            setMessages((prev) => [
              ...prev,
              { id: assistantMessageId, role: 'assistant', content: '', timestamp: Date.now() },
            ]);
          }
        } else if (event.type === 'message_update') {
          const aEvent = event.assistantMessageEvent;
          if (aEvent.type === 'text_delta') {
            assistantContent += aEvent.delta;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, content: assistantContent }
                  : m,
              ),
            );
          }
        } else if (event.type === 'tool_execution_start') {
          setMessages((prev) => [
            ...prev,
            {
              id: `tool_${event.toolCallId}`,
              role: 'tool',
              content: `Calling tool: ${event.toolName}`,
              timestamp: Date.now(),
            },
          ]);
        } else if (event.type === 'tool_execution_end') {
          const resultText = event.result?.content
            ?.map((c: { type: string; text?: string }) =>
              c.type === 'text' ? c.text : '',
            )
            .join('') || '';
          setMessages((prev) =>
            prev.map((m) =>
              m.id === `tool_${event.toolCallId}`
                ? {
                    ...m,
                    content: `${event.toolName}: ${resultText.slice(0, 500)}${event.isError ? ' (error)' : ''}`,
                  }
                : m,
            ),
          );
        } else if (event.type === 'agent_end') {
          setIsStreaming(false);
        } else if (event.type === 'runtime_error') {
          setMessages((prev) => [
            ...prev,
            {
              id: `err_${Date.now()}`,
              role: 'assistant',
              content: `Error: ${event.error}`,
              timestamp: Date.now(),
            },
          ]);
          setIsStreaming(false);
        }
      });

      unsubRef.current = unsub;

      await runtime.prompt(userMessage.content);
    } catch (error) {
      setMessages((prev) => [
        ...prev,
        {
          id: `msg_${Date.now()}_err`,
          role: 'assistant',
          content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}. Make sure you have configured your API keys in Settings.`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, config, agentNodeId, getOrCreateRuntime, getApiKey]);

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
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : msg.role === 'tool'
                    ? 'border border-slate-700 bg-slate-800/50 text-slate-400 italic'
                    : 'bg-slate-800 text-slate-200'
              }`}
            >
              <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
              {msg.role === 'assistant' && !msg.content && isStreaming && (
                <span className="inline-block h-3 w-1 animate-pulse bg-slate-400" />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

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
          <button
            onClick={sendMessage}
            disabled={isStreaming || !input.trim()}
            className="rounded-lg bg-blue-600 p-2 text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
