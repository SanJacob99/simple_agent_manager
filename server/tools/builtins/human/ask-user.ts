import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { HitlRegistry } from '../../../hitl/hitl-registry';
import type { HitlInputRequiredEvent, HitlResolvedEvent } from '../../../../shared/protocol';

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TIMEOUT_MS = 55_000; // Stay under Gemini's 60s streaming idle limit.

export interface AskUserContext {
  agentId: string;
  getSessionKey: () => string;
  registry: HitlRegistry;
  emit: (event: HitlInputRequiredEvent | HitlResolvedEvent) => void;
}

function textResult(text: string, details: unknown): AgentToolResult<any> {
  return { content: [{ type: 'text', text }], details };
}

/**
 * Freeform Q&A — pauses the run until the user types a text answer.
 * Use `confirm_action` instead for yes/no gates on risky operations.
 */
export function createAskUserTool(ctx: AskUserContext): AgentTool<TSchema> {
  return {
    name: 'ask_user',
    description:
      'Pause and ask the human a freeform question when you need information or clarification you cannot infer. ' +
      'Examples: "what filename should I use?", "which directory?", "what tone should the email have?". ' +
      'For yes/no gates before destructive actions use `confirm_action` instead. ' +
      'This tool blocks the turn until the user replies or the prompt times out.',
    label: 'Ask User',
    parameters: Type.Object({
      question: Type.String({
        description: 'A short, specific question. One sentence is ideal.',
      }),
      timeoutSeconds: Type.Optional(
        Type.Number({
          description: `Wait this long before returning {cancelled:true,reason:"timeout"}. Default ${DEFAULT_TIMEOUT_MS / 1000}s, max ${MAX_TIMEOUT_MS / 1000}s.`,
        }),
      ),
    }),
    execute: async (toolCallId, params: any, signal) => {
      const question = (params.question as string)?.trim();
      if (!question) throw new Error('ask_user requires a "question" argument');

      const requestedTimeout =
        typeof params.timeoutSeconds === 'number' && params.timeoutSeconds > 0
          ? Math.min(params.timeoutSeconds * 1000, MAX_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS;

      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const sessionKey = ctx.getSessionKey();
      if (!sessionKey) {
        throw new Error('ask_user: no active session — tool invoked outside a run context');
      }

      ctx.emit({
        type: 'hitl:input_required',
        agentId: ctx.agentId,
        sessionKey,
        toolCallId,
        toolName: 'ask_user',
        kind: 'text',
        question,
        timeoutMs: requestedTimeout,
        createdAt: Date.now(),
      });

      const onAbort = () => {
        ctx.registry.resolve(ctx.agentId, sessionKey, toolCallId, {
          cancelled: true, reason: 'aborted',
        });
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      let answer;
      try {
        answer = await ctx.registry.register({
          agentId: ctx.agentId,
          sessionKey,
          toolCallId,
          toolName: 'ask_user',
          kind: 'text',
          question,
          timeoutMs: requestedTimeout,
        });
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }

      ctx.emit({
        type: 'hitl:resolved',
        agentId: ctx.agentId,
        sessionKey,
        toolCallId,
        outcome: 'cancelled' in answer ? 'cancelled' : 'answered',
        reason: 'cancelled' in answer ? answer.reason : undefined,
      });

      if ('cancelled' in answer) {
        return textResult(
          `[user did not answer: ${answer.reason}]`,
          { status: 'cancelled', reason: answer.reason },
        );
      }

      if (answer.kind !== 'text') {
        // Should not happen — the registry returns the kind we registered with.
        return textResult(String((answer as any).answer), { status: 'answered' });
      }

      return textResult(answer.answer, { status: 'answered', answer: answer.answer });
    },
  };
}
