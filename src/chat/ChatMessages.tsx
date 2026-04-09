import { useRef, useEffect, useCallback, useMemo } from 'react';
import { Brain, RefreshCw } from 'lucide-react';
import { useSessionStore, type Message } from '../store/session-store';
import type { ContextWindowInfo, PeripheralReservation } from './useContextWindow';
import ContextUsagePanel from './ContextUsagePanel';
import MessageBubble from './MessageBubble';

// Stable empty array — never recreated, so the Zustand selector always returns
// the same reference when there are no messages (avoids infinite snapshot loop).
const EMPTY: Message[] = [];

interface ChatMessagesProps {
  activeSessionKey: string | null;
  isBlocked: boolean;
  isStreaming: boolean;
  isReasoning: boolean;
  compacting: boolean;
  suppressedReply: boolean;
  streamingMsgId: string;
  contextInfo: ContextWindowInfo;
  peripheralReservations: PeripheralReservation[];
}

export default function ChatMessages({
  activeSessionKey,
  isBlocked,
  isStreaming,
  isReasoning,
  compacting,
  suppressedReply,
  streamingMsgId,
  contextInfo,
  peripheralReservations,
}: ChatMessagesProps) {
  // Stable fallback — must NOT be inline `?? []` inside the selector because
  // that creates a new array reference every call, causing useSyncExternalStore
  // to see a perpetually-changing snapshot and loop infinitely.
  const messages = useSessionStore(
    (s) => s.sessions[activeSessionKey ?? '']?.messages ?? EMPTY,
  );

  // ContextUsagePanel only needs tokenCount/usage — derive a stable array that
  // does NOT change on content-only updates (streaming deltas).
  const tokenKey = messages.map((m) => `${m.id}:${m.tokenCount ?? 0}`).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const messagesForContext = useMemo(() => messages, [tokenKey]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isUserScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
  }, []);

  useEffect(() => {
    const isNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (isUserScrolledUpRef.current && !isNewMessage) return;
    if (isNewMessage) isUserScrolledUpRef.current = false;

    messagesEndRef.current?.scrollIntoView({
      behavior: isNewMessage && !isStreaming ? 'smooth' : 'instant',
    });
  }, [messages, isStreaming]);

  return (
    <>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto p-4 space-y-3 ${isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}`}
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-slate-600">Send a message to start the conversation</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isStreamingThis={isStreaming && msg.id === streamingMsgId}
          />
        ))}
        {isReasoning && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-purple-500/10 border border-purple-500/20">
            <Brain size={12} className="text-purple-400 animate-pulse" />
            <span className="text-[10px] text-purple-300">Thinking...</span>
          </div>
        )}
        {compacting && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
            <RefreshCw size={12} className="text-amber-400 animate-spin" />
            <span className="text-[10px] text-amber-300">Compacting context...</span>
          </div>
        )}
        {suppressedReply && !isStreaming && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 text-[10px] text-slate-500 italic bg-slate-800/30 border border-slate-700/50">
              Agent chose not to reply
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}>
        <ContextUsagePanel
          messages={messagesForContext}
          contextInfo={contextInfo}
          peripheralReservations={peripheralReservations}
        />
      </div>
    </>
  );
}
