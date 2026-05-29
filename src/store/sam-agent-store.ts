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
  thinking: string;
  isThinking: boolean;
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
 * Per-store map from toolCallId → { toolName, argsJson } for in-flight tool calls.
 * Kept outside Zustand state because it is transient bookkeeping, not UI state.
 */
const pendingToolCalls = new Map<string, { toolName: string; argsJson: string }>();

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
        // Within one user turn the server keeps the same messageId across
        // multiple runtime message_start cycles (text → tool → text). Only
        // reset accumulators when we're starting a brand-new assistant turn;
        // otherwise the second pass would wipe the text rendered during the
        // first — the "appear and disappear" bug.
        set((s) =>
          s.streaming && s.streaming.messageId === event.messageId
            ? {}
            : {
                streaming: {
                  messageId: event.messageId,
                  text: '',
                  thinking: '',
                  isThinking: false,
                },
              },
        );
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

      case 'thinking:start':
        set((s) => {
          if (s.streaming && s.streaming.messageId === event.messageId) {
            return { streaming: { ...s.streaming, isThinking: true } };
          }
          // Thinking can arrive before any message:start (some providers emit
          // it first). Initialise a streaming block on the fly.
          return {
            streaming: {
              messageId: event.messageId,
              text: '',
              thinking: '',
              isThinking: true,
            },
          };
        });
        break;

      case 'thinking:delta':
        set((s) =>
          s.streaming
            ? {
                streaming: {
                  ...s.streaming,
                  thinking: s.streaming.thinking + event.textDelta,
                  isThinking: true,
                },
              }
            : {},
        );
        break;

      case 'thinking:end':
        set((s) =>
          s.streaming ? { streaming: { ...s.streaming, isThinking: false } } : {},
        );
        break;

      case 'tool:start':
        // Track tool name + args so tool:end can associate them with the result.
        pendingToolCalls.set(event.toolCallId, {
          toolName: event.toolName,
          argsJson: event.argsJson,
        });
        break;

      case 'tool:end': {
        const pending = pendingToolCalls.get(event.toolCallId);
        const toolName = pending?.toolName ?? '';
        pendingToolCalls.delete(event.toolCallId);
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
            thinking: s.streaming.thinking.length > 0 ? s.streaming.thinking : undefined,
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
    // The patch can live in either `messages` (committed at lifecycle:end) or
    // `streaming.toolResults` (in-flight turn). The Apply card renders against
    // whichever holds it, so the patchState must propagate to both — otherwise
    // clicking Apply on a live patch never flips the card off "pending" and a
    // second click re-applies it.
    set((s) => {
      const updatedMessages = s.messages.map((m) => {
        if (m.id !== messageId || !m.toolResults) return m;
        return {
          ...m,
          toolResults: m.toolResults.map((tr) =>
            tr.toolCallId === toolCallId ? { ...tr, patchState: state } : tr,
          ),
        };
      });
      const updatedStreaming =
        s.streaming && s.streaming.messageId === messageId && s.streaming.toolResults
          ? {
              ...s.streaming,
              toolResults: s.streaming.toolResults.map((tr) =>
                tr.toolCallId === toolCallId ? { ...tr, patchState: state } : tr,
              ),
            }
          : s.streaming;
      return { messages: updatedMessages, streaming: updatedStreaming };
    });
  },

  clearLocal: () => {
    pendingToolCalls.clear();
    set({ messages: [], streaming: null, hitlPending: null });
  },
}));
