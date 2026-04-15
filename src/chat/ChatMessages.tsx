import { memo, useRef, useEffect, useCallback, useMemo, useLayoutEffect, useState } from 'react';
import { RefreshCw, MessageSquareMore } from 'lucide-react';
import { useSessionStore, type Message } from '../store/session-store';
import type { ContextWindowInfo, PeripheralReservation } from './useContextWindow';
import ContextUsagePanel from './ContextUsagePanel';
import MessageBubble from './MessageBubble';
import {
  getAssistantMessageIds,
  getInitialRichMarkdownMessageIds,
  MARKDOWN_BATCH_SIZE,
} from './markdown-rendering';

// Stable empty array — never recreated, so the Zustand selector always returns
// the same reference when there are no messages (avoids infinite snapshot loop).
const EMPTY: Message[] = [];

interface ChatMessagesProps {
  activeSessionKey: string | null;
  isBlocked: boolean;
  isTranscriptLoading: boolean;
  isStreaming: boolean;
  isReasoning: boolean;
  compacting: boolean;
  suppressedReply: boolean;
  streamingMsgId: string;
  contextInfo: ContextWindowInfo;
  peripheralReservations: PeripheralReservation[];
}

function ChatMessages({
  activeSessionKey,
  isBlocked,
  isTranscriptLoading,
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
  const assistantMessageIds = useMemo(() => getAssistantMessageIds(messages), [messages]);
  const assistantIdKey = assistantMessageIds.join(',');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isUserScrolledUpRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  const prevSessionKeyRef = useRef<string | null>(null);
  const prevTranscriptLoadingRef = useRef(isTranscriptLoading);
  const pinToBottomRef = useRef(false);
  const [richMarkdownIds, setRichMarkdownIds] = useState<Set<string>>(() => new Set());

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    isUserScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 80;
  }, []);

  useEffect(() => {
    if (prevSessionKeyRef.current !== activeSessionKey) {
      prevSessionKeyRef.current = activeSessionKey;
      prevMessageCountRef.current = 0;
      isUserScrolledUpRef.current = false;
      pinToBottomRef.current = true;
    }

    if (prevTranscriptLoadingRef.current && !isTranscriptLoading) {
      pinToBottomRef.current = true;
    }

    prevTranscriptLoadingRef.current = isTranscriptLoading;
  }, [activeSessionKey, isTranscriptLoading]);

  useLayoutEffect(() => {
    if (isTranscriptLoading) return;

    const isNewMessage = messages.length > prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (pinToBottomRef.current) {
      pinToBottomRef.current = false;
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      return;
    }

    if (isUserScrolledUpRef.current && !isNewMessage) return;
    if (isNewMessage) isUserScrolledUpRef.current = false;

    messagesEndRef.current?.scrollIntoView({
      behavior: isNewMessage && !isStreaming ? 'smooth' : 'instant',
    });
  }, [messages, isStreaming, isTranscriptLoading]);

  useEffect(() => {
    if (isTranscriptLoading) return;

    const initialIds = getInitialRichMarkdownMessageIds(messages);
    setRichMarkdownIds(new Set(initialIds));

    if (assistantMessageIds.length <= initialIds.length) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let renderedCount = initialIds.length;

    const scheduleNextBatch = () => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (cancelled) return;

        const nextEnd = assistantMessageIds.length - renderedCount;
        const nextStart = Math.max(nextEnd - MARKDOWN_BATCH_SIZE, 0);
        const batchIds = assistantMessageIds.slice(nextStart, nextEnd);
        renderedCount += batchIds.length;

        setRichMarkdownIds((prev) => {
          const next = new Set(prev);
          batchIds.forEach((id) => next.add(id));
          return next;
        });

        if (renderedCount < assistantMessageIds.length) {
          scheduleNextBatch();
        }
      }, 16);
    };

    scheduleNextBatch();

    return () => {
      cancelled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [assistantIdKey, assistantMessageIds, isTranscriptLoading, messages]);

  return (
    <>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto p-4 space-y-3 ${isBlocked ? 'pointer-events-none select-none blur-[2px]' : ''}`}
      >
        {isTranscriptLoading && (
          <div className="flex h-full items-center justify-center">
            <div className="flex w-full max-w-[280px] flex-col items-center gap-4 rounded-2xl border border-slate-800 bg-slate-950/80 px-6 py-8 text-center">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900">
                <MessageSquareMore size={18} className="text-blue-300" />
                <span className="absolute inset-0 rounded-2xl border border-blue-400/20 animate-ping" />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-200">Loading</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-bounce rounded-full bg-blue-400 [animation-delay:-0.2s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-blue-300 [animation-delay:-0.1s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-blue-200" />
              </div>
            </div>
          </div>
        )}
        {!isTranscriptLoading && messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-slate-600">Send a message to start the conversation</p>
          </div>
        )}
        {!isTranscriptLoading && messages.map((msg) => {
          const isStreamingThis = isStreaming && msg.id === streamingMsgId;
          return (
            <MessageBubble
              key={msg.id}
              msg={msg}
              isStreamingThis={isStreamingThis}
              isReasoningThis={isStreamingThis && isReasoning}
              preferPlainText={msg.role === 'assistant' && !richMarkdownIds.has(msg.id)}
            />
          );
        })}
        {!isTranscriptLoading && compacting && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20">
            <RefreshCw size={12} className="text-amber-400 animate-spin" />
            <span className="text-[10px] text-amber-300">Compacting context...</span>
          </div>
        )}
        {!isTranscriptLoading && suppressedReply && !isStreaming && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 text-[10px] text-slate-500 italic bg-slate-800/30 border border-slate-700/50">
              Agent chose not to reply
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className={isBlocked || isTranscriptLoading ? 'pointer-events-none select-none blur-[2px]' : ''}>
        <ContextUsagePanel
          messages={messagesForContext}
          contextInfo={contextInfo}
          peripheralReservations={peripheralReservations}
        />
      </div>
    </>
  );
}

export default memo(ChatMessages);
