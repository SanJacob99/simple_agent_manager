import { useRef, useEffect, useState, useCallback } from 'react';
import { X, Send, Bot } from 'lucide-react';
import { useGraphStore } from '../store/graph-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';

interface Message {
  id: string;
  role: 'user' | 'assistant';
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
  const config = resolveAgentConfig(agentNodeId, nodes, edges);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      // Dynamic import of pi-ai for LLM streaming
      const { getModel, stream } = await import('@mariozechner/pi-ai');

      const model = getModel(
        config.provider as any,
        config.modelId as any,
      );

      const allMessages = [
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.timestamp,
        })),
        { role: 'user' as const, content: userMessage.content, timestamp: userMessage.timestamp },
      ];

      const context = {
        systemPrompt: config.systemPrompt,
        messages: allMessages,
      } as any;

      const assistantMessage: Message = {
        id: `msg_${Date.now()}_a`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      const s = stream(model, context);
      for await (const event of s) {
        if (event.type === 'text_delta') {
          assistantMessage.content += event.delta;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessage.id
                ? { ...m, content: assistantMessage.content }
                : m,
            ),
          );
        }
      }
    } catch (error) {
      const errorMessage: Message = {
        id: `msg_${Date.now()}_err`,
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}. Make sure you have configured your API keys.`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsStreaming(false);
    }
  }, [input, isStreaming, config, messages]);

  if (!config) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-[420px] flex-col border-l border-slate-700 bg-slate-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
        <Bot size={18} className="text-blue-400" />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-slate-100">
            {config.agentNode.data.name}
          </h3>
          <p className="text-[10px] text-slate-500">
            {config.provider} / {config.modelId}
          </p>
        </div>
        <button
          onClick={onClose}
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
