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
  const sessionKeyRef = useRef<string>('');

  const cleanup = useCallback(() => {
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
            addMessage(sessionKeyRef.current, {
              id: assistantMsgIdRef.current,
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
            });
            break;

          case 'message:delta':
            assistantContentRef.current += event.delta;
            updateMessage(sessionKeyRef.current, assistantMsgIdRef.current, (m) => ({
              ...m,
              content: assistantContentRef.current,
            }));
            break;

          case 'message:end':
            if (event.message.usage) {
              updateMessage(sessionKeyRef.current, assistantMsgIdRef.current, (m) => ({
                ...m,
                tokenCount: event.message.usage!.output,
                usage: event.message.usage,
              }));
            }
            void flushSession(sessionKeyRef.current);
            break;

          case 'reasoning:start':
            setIsReasoning(true);
            setReasoning('');
            break;

          case 'reasoning:delta':
            setReasoning((prev) => (prev ?? '') + (event as any).delta);
            break;

          case 'reasoning:end':
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

      void sendPrompt(agentNodeId, sessionKey, text, attachments).catch(() => undefined);
    },
    [agentNodeId, addMessage, updateMessage, deleteMessage, flushSession, sendPrompt, cleanup],
  );

  return {
    isStreaming,
    reasoning,
    isReasoning,
    suppressedReply,
    compacting,
    toolSummaries,
    sendMessage,
  };
}
