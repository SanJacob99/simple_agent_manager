import { create } from 'zustand';
import type { SamAgentMessage, SamAgentEvent } from '../../shared/sam-agent/protocol-types';

export type SamAgentHitlPending = {
  toolCallId: string;
  kind: 'text' | 'confirm';
  question: string;
  timeoutMs: number;
};

/** Streaming state accumulated during an in-flight assistant turn. */
type StreamingState = {
  messageId: string;
  text: string;
  toolResults?: SamAgentMessage['toolResults'];
};

interface SamAgentState {
  messages: SamAgentMessage[];
  streaming: StreamingState | null;
  hitlPending: SamAgentHitlPending | null;
  transcriptLoaded: boolean;

  loadTranscript(messages: SamAgentMessage[]): void;
  appendUserMessage(text: string): SamAgentMessage;
  handleEvent(event: SamAgentEvent): void;
  setPatchState(
    messageId: string,
    toolCallId: string,
    state: NonNullable<NonNullable<SamAgentMessage['toolResults']>[number]['patchState']>,
  ): void;
  clearLocal(): void;
}

/**
 * Per-store map from toolCallId → toolName for in-flight tool calls.
 * Kept outside Zustand state because it is transient bookkeeping, not UI state.
 */
const pendingToolNames = new Map<string, string>();

export const useSamAgentStore = create<SamAgentState>((set) => ({
  messages: [],
  streaming: null,
  hitlPending: null,
  transcriptLoaded: false,

  loadTranscript: (messages) => set({ messages, transcriptLoaded: true }),

  appendUserMessage: (text) => {
    const id = `u-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const message: SamAgentMessage = { id, role: 'user', text, timestamp: Date.now() };
    set((s) => ({ messages: [...s.messages, message] }));
    return message;
  },

  handleEvent: (event) => {
    switch (event.type) {
      case 'message:start':
        set({ streaming: { messageId: event.messageId, text: '' } });
        break;

      case 'message:delta':
        set((s) =>
          s.streaming
            ? { streaming: { ...s.streaming, text: s.streaming.text + event.textDelta } }
            : {},
        );
        break;

      case 'message:end':
        set((s) =>
          s.streaming
            ? { streaming: { ...s.streaming, text: event.text ?? s.streaming.text } }
            : {},
        );
        break;

      case 'tool:start':
        // Track tool name so tool:end can associate it with the result.
        pendingToolNames.set(event.toolCallId, event.toolName);
        break;

      case 'tool:end': {
        const toolName = pendingToolNames.get(event.toolCallId) ?? '';
        pendingToolNames.delete(event.toolCallId);
        set((s) => {
          if (!s.streaming) return {};
          const existing = s.streaming.toolResults ?? [];
          const next: NonNullable<SamAgentMessage['toolResults']> = [
            ...existing,
            {
              toolName,
              toolCallId: event.toolCallId,
              resultJson: event.resultJson,
              patchState: toolName === 'propose_workflow_patch' ? ('pending' as const) : undefined,
            },
          ];
          return { streaming: { ...s.streaming, toolResults: next } };
        });
        break;
      }

      case 'lifecycle:end':
        set((s) => {
          if (!s.streaming) return {};
          const completed: SamAgentMessage = {
            id: s.streaming.messageId,
            role: 'assistant',
            text: s.streaming.text,
            timestamp: Date.now(),
            toolResults: s.streaming.toolResults,
          };
          return { messages: [...s.messages, completed], streaming: null };
        });
        break;

      case 'lifecycle:error':
        set((s) => ({
          streaming: null,
          messages: [
            ...s.messages,
            {
              id: `err-${Date.now()}`,
              role: 'assistant' as const,
              text: `error: ${event.error}`,
              timestamp: Date.now(),
            },
          ],
        }));
        break;

      case 'hitl:input_required':
        set({
          hitlPending: {
            toolCallId: event.toolCallId,
            kind: event.kind,
            question: event.question,
            timeoutMs: event.timeoutMs,
          },
        });
        break;

      case 'hitl:resolved':
        set({ hitlPending: null });
        break;

      // lifecycle:start, tool:start are handled above or ignored
      default:
        break;
    }
  },

  setPatchState: (messageId, toolCallId, state) => {
    set((s) => ({
      messages: s.messages.map((m) => {
        if (m.id !== messageId || !m.toolResults) return m;
        return {
          ...m,
          toolResults: m.toolResults.map((tr) =>
            tr.toolCallId === toolCallId ? { ...tr, patchState: state } : tr,
          ),
        };
      }),
    }));
  },

  clearLocal: () => {
    pendingToolNames.clear();
    set({ messages: [], streaming: null, hitlPending: null });
  },
}));
