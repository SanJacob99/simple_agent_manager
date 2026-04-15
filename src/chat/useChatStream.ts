import { useEffect, useRef, useCallback, useState } from 'react';
import { useSessionStore } from '../store/session-store';
import { useAgentConnectionStore } from '../store/agent-connection-store';
import { estimateTokens } from '../../shared/token-estimator';
import type { ServerEvent } from '../../shared/protocol';
import { agentClient } from '../client';

export interface ToolSummaryInfo {
  toolCallId: string;
  toolName: string;
  summary: string;
}

export interface ChatStreamState {
  isStreaming: boolean;
  streamingMsgId: string;
  reasoning: string | null;
  isReasoning: boolean;
  suppressedReply: boolean;
  compacting: boolean;
  toolSummaries: ToolSummaryInfo[];
  sendMessage: (text: string, sessionKey: string, attachments?: any[]) => void;
}

export function useChatStream(agentNodeId: string): ChatStreamState {
  const [isStreaming, setIsStreaming] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [isReasoning, setIsReasoning] = useState(false);
  const [suppressedReply, setSuppressedReply] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [toolSummaries, setToolSummaries] = useState<ToolSummaryInfo[]>([]);

  const addMessage = useSessionStore((s) => s.addMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);
  const deleteMessage = useSessionStore((s) => s.deleteMessage);
  const flushSession = useSessionStore((s) => s.flushSession);
  const sendPrompt = useAgentConnectionStore((s) => s.sendPrompt);

  const unsubRef = useRef<(() => void) | null>(null);
  const assistantMsgIdRef = useRef<string>('');
  const assistantContentRef = useRef<string>('');
  const assistantThinkingRef = useRef<string>('');
  const assistantMsgCreatedRef = useRef<boolean>(false);
  const sessionKeyRef = useRef<string>('');
  const pendingDeltaRef = useRef<string>('');
  const pendingThinkingDeltaRef = useRef<string>('');
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDelta = useCallback(() => {
    flushTimerRef.current = null;
    if (!pendingDeltaRef.current) return;
    assistantContentRef.current += pendingDeltaRef.current;
    pendingDeltaRef.current = '';
    updateMessage(sessionKeyRef.current, assistantMsgIdRef.current, (m) => ({
      ...m,
      content: assistantContentRef.current,
    }));
  }, [updateMessage]);

  const flushThinkingDelta = useCallback(() => {
    thinkingFlushTimerRef.current = null;
    if (!pendingThinkingDeltaRef.current) return;
    assistantThinkingRef.current += pendingThinkingDeltaRef.current;
    pendingThinkingDeltaRef.current = '';
    updateMessage(sessionKeyRef.current, assistantMsgIdRef.current, (m) => ({
      ...m,
      thinking: assistantThinkingRef.current,
    }));
  }, [updateMessage]);

  const cleanup = useCallback(() => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (thinkingFlushTimerRef.current !== null) {
      clearTimeout(thinkingFlushTimerRef.current);
      thinkingFlushTimerRef.current = null;
    }
    // Flush any buffered deltas before tearing down
    if (pendingDeltaRef.current) {
      assistantContentRef.current += pendingDeltaRef.current;
      pendingDeltaRef.current = '';
    }
    if (pendingThinkingDeltaRef.current) {
      assistantThinkingRef.current += pendingThinkingDeltaRef.current;
      pendingThinkingDeltaRef.current = '';
    }
    unsubRef.current?.();
    unsubRef.current = null;
  }, []);

  // Clean up on unmount
  useEffect(() => cleanup, [cleanup]);

  const sendMessage = useCallback(
    (text: string, sessionKey: string, attachments?: any[]) => {
      cleanup();

      const msgId = `msg_${Date.now()}_a`;
      assistantMsgIdRef.current = msgId;
      assistantContentRef.current = '';
      assistantThinkingRef.current = '';
      assistantMsgCreatedRef.current = false;
      sessionKeyRef.current = sessionKey;

      setIsStreaming(true);
      setSuppressedReply(false);
      setToolSummaries([]);
      setReasoning(null);
      setIsReasoning(false);

      const unsub = agentClient.onEvent((event: ServerEvent) => {
        if (!('agentId' in event) || (event as any).agentId !== agentNodeId) return;

        switch (event.type) {
          case 'message:start':
            assistantContentRef.current = '';
            setReasoning(null);
            setIsReasoning(false);
            if (!assistantMsgCreatedRef.current) {
              addMessage(sessionKeyRef.current, {
                id: assistantMsgIdRef.current,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                thinking: assistantThinkingRef.current || undefined,
              });
              assistantMsgCreatedRef.current = true;
            }
            break;

          case 'message:delta':
            pendingDeltaRef.current += event.delta;
            if (flushTimerRef.current === null) {
              flushTimerRef.current = setTimeout(flushDelta, 32);
            }
            break;

          case 'message:end':
            // Cancel pending timer and flush any remaining buffered text immediately
            if (flushTimerRef.current !== null) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            if (pendingDeltaRef.current) {
              assistantContentRef.current += pendingDeltaRef.current;
              pendingDeltaRef.current = '';
            }
            updateMessage(sessionKeyRef.current, assistantMsgIdRef.current, (m) => ({
              ...m,
              content: assistantContentRef.current,
              ...(event.message.usage && {
                tokenCount: event.message.usage.output,
                usage: event.message.usage,
              }),
            }));
            void flushSession(sessionKeyRef.current);
            break;

          case 'reasoning:start':
            setIsReasoning(true);
            setReasoning('');
            assistantThinkingRef.current = '';
            if (!assistantMsgCreatedRef.current) {
              addMessage(sessionKeyRef.current, {
                id: assistantMsgIdRef.current,
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
              });
              assistantMsgCreatedRef.current = true;
            }
            break;

          case 'reasoning:delta': {
            const delta = (event as any).delta as string;
            setReasoning((prev) => (prev ?? '') + delta);
            pendingThinkingDeltaRef.current += delta;
            if (thinkingFlushTimerRef.current === null) {
              thinkingFlushTimerRef.current = setTimeout(flushThinkingDelta, 64);
            }
            break;
          }

          case 'reasoning:end':
            if (thinkingFlushTimerRef.current !== null) {
              clearTimeout(thinkingFlushTimerRef.current);
              thinkingFlushTimerRef.current = null;
            }
            if (pendingThinkingDeltaRef.current) {
              assistantThinkingRef.current += pendingThinkingDeltaRef.current;
              pendingThinkingDeltaRef.current = '';
              updateMessage(sessionKeyRef.current, assistantMsgIdRef.current, (m) => ({
                ...m,
                thinking: assistantThinkingRef.current,
              }));
            }
            setIsReasoning(false);
            break;

          case 'message:suppressed':
            setSuppressedReply(true);
            if (assistantMsgIdRef.current) {
              deleteMessage(sessionKeyRef.current, assistantMsgIdRef.current);
              void flushSession(sessionKeyRef.current);
            }
            break;

          case 'tool:start':
            addMessage(sessionKeyRef.current, {
              id: `tool_${(event as any).toolCallId}`,
              role: 'tool',
              content: `Calling tool: ${(event as any).toolName}`,
              timestamp: Date.now(),
            });
            break;

          case 'tool:end': {
            const te = event as any;
            const toolContent = `${te.toolName}: ${te.result}${te.isError ? ' (error)' : ''}`;
            updateMessage(sessionKeyRef.current, `tool_${te.toolCallId}`, (m) => ({
              ...m,
              content: toolContent,
              tokenCount: estimateTokens(toolContent),
            }));
            void flushSession(sessionKeyRef.current);
            break;
          }

          case 'tool:summary':
            setToolSummaries((prev) => [
              ...prev,
              {
                toolCallId: (event as any).toolCallId,
                toolName: (event as any).toolName,
                summary: (event as any).summary,
              },
            ]);
            break;

          case 'compaction:start':
            setCompacting(true);
            break;

          case 'compaction:end':
            setCompacting(false);
            break;

          case 'agent:end':
          case 'lifecycle:end':
            if (assistantContentRef.current.trim() === '' && assistantMsgIdRef.current) {
              deleteMessage(sessionKeyRef.current, assistantMsgIdRef.current);
            }
            setIsStreaming(false);
            setIsReasoning(false);
            setCompacting(false);
            void flushSession(sessionKeyRef.current);
            unsub();
            break;

          case 'agent:error':
          case 'lifecycle:error': {
            const errorMsg = (event as any).error?.message ?? (event as any).error ?? 'Unknown error';
            addMessage(sessionKeyRef.current, {
              id: `err_${Date.now()}`,
              role: 'assistant',
              content: `Error: ${errorMsg}`,
              timestamp: Date.now(),
            });
            setIsStreaming(false);
            setIsReasoning(false);
            setCompacting(false);
            void flushSession(sessionKeyRef.current);
            unsub();
            break;
          }
        }
      });

      unsubRef.current = unsub;

      void sendPrompt(agentNodeId, sessionKey, text, attachments)
        .catch(() => undefined);
    },
    [agentNodeId, addMessage, updateMessage, deleteMessage, flushSession, sendPrompt, cleanup],
  );

  return {
    isStreaming,
    streamingMsgId: assistantMsgIdRef.current,
    reasoning,
    isReasoning,
    suppressedReply,
    compacting,
    toolSummaries,
    sendMessage,
  };
}
