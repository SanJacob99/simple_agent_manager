import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { HitlRegistry } from '../../../hitl/hitl-registry';
import type { HitlInputRequiredEvent, HitlResolvedEvent } from '../../../../shared/protocol';

const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_TIMEOUT_MS = 55_000;

export interface ConfirmActionContext {
  agentId: string;
  getSessionKey: () => string;
  registry: HitlRegistry;
  emit: (event: HitlInputRequiredEvent | HitlResolvedEvent) => void;
}

function textResult(text: string, details: unknown): AgentToolResult<any> {
  return { content: [{ type: 'text', text }], details };
}

/**
 * Strict yes/no human confirmation gate. Returns the literal string
 * "yes" or "no", or {cancelled,...}. The model should call this BEFORE
 * any destructive or irreversible action.
 *
 * This is a separate tool (rather than a `kind` parameter on `ask_user`)
 * because tool NAMES land more reliably than enum values across every
 * provider — including older / smaller models that skim descriptions.
 */
export function createConfirmActionTool(ctx: ConfirmActionContext): AgentTool<TSchema> {
  return {
    name: 'confirm_action',
    description:
      'Ask the human for a strict yes/no confirmation BEFORE performing a destructive, irreversible, '
      + 'or state-mutating action — for example: deleting files, overwriting a path, running a shell '
      + 'command that modifies the system, making a network POST/PUT/DELETE, sending a message. '
      + 'Summarize exactly what you are about to do in the question. '
      + 'Returns "yes" or "no". '
      + 'CRITICAL: this must be the ONLY tool call in the turn where you use it — do not call any '
      + 'other tool alongside the confirmation. Wait for the answer, then act on it in the next turn.',
    label: 'Confirm Action',
    parameters: Type.Object({
      question: Type.String({
        description:
          'Short summary of the pending action, phrased as a yes/no question. '
          + 'Example: "Delete 12 files under ./build — proceed?"',
      }),
      timeoutSeconds: Type.Optional(
        Type.Number({
          description: `Wait this long before returning {cancelled:true,reason:"timeout"}. Default ${DEFAULT_TIMEOUT_MS / 1000}s, max ${MAX_TIMEOUT_MS / 1000}s.`,
        }),
      ),
    }),
    execute: async (toolCallId, params: any, signal) => {
      const question = (params.question as string)?.trim();
      if (!question) throw new Error('confirm_action requires a "question" argument');

      const requestedTimeout =
        typeof params.timeoutSeconds === 'number' && params.timeoutSeconds > 0
          ? Math.min(params.timeoutSeconds * 1000, MAX_TIMEOUT_MS)
          : DEFAULT_TIMEOUT_MS;

      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const sessionKey = ctx.getSessionKey();
      if (!sessionKey) {
        throw new Error('confirm_action: no active session — tool invoked outside a run context');
      }

      ctx.emit({
        type: 'hitl:input_required',
        agentId: ctx.agentId,
        sessionKey,
        toolCallId,
        toolName: 'confirm_action',
        kind: 'confirm',
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
          toolName: 'confirm_action',
          kind: 'confirm',
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
        // Treat cancellation as a "no" for safety — if the user can't or won't
        // answer, the action must NOT proceed. The details still say cancelled
        // so the model can distinguish from an explicit decline.
        return textResult('no', { status: 'cancelled', reason: answer.reason });
      }

      if (answer.kind !== 'confirm') {
        return textResult('no', { status: 'error', error: 'unexpected_kind' });
      }

      return textResult(answer.answer, { status: 'answered', answer: answer.answer });
    },
  };
}
