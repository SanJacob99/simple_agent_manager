import { streamSimple, createAssistantMessageEventStream } from '@mariozechner/pi-ai';
import type { StreamFn } from '@mariozechner/pi-agent-core';
import { log } from '../logger';

const FINISH_REASON_PREFIX = 'Provider finish_reason:';

// Providers like Google Gemini (via OpenRouter's openai-completions API) pass
// through finish_reason values that pi-ai's mapStopReason does not recognize.
// Any unknown value becomes stopReason: "error", which causes pi-agent-core's
// agent-loop to immediately bail without attempting another turn — even when
// the model actually produced a full tool call and the run should continue.
// This map rewrites the known-benign values into equivalents that keep the
// loop alive. True blocks (safety/recitation) stay as errors by returning null.
export function mapUnknownFinishReason(
  raw: string,
  hasToolCalls: boolean,
): string | null {
  const upper = raw.toUpperCase();
  switch (upper) {
    case 'MAX_TOKENS':
      return 'length';
    case 'MALFORMED_FUNCTION_CALL':
    case 'OTHER':
    case 'FINISH_REASON_UNSPECIFIED':
    case 'COMPLETE':
    case 'FINISH':
      return hasToolCalls ? 'toolUse' : 'stop';
    case 'TOOL_CALLS':
    case 'TOOLS':
    case 'FUNCTION_CALL':
      return 'toolUse';
    default:
      // SAFETY, RECITATION, CONTENT_FILTER, BLOCKED, and anything truly unknown
      // stay as errors so the user sees they were blocked.
      return null;
  }
}

export function extractFinishReason(errorMessage: unknown): string | null {
  if (typeof errorMessage !== 'string') return null;
  if (!errorMessage.startsWith(FINISH_REASON_PREFIX)) return null;
  return errorMessage.slice(FINISH_REASON_PREFIX.length).trim();
}

/**
 * streamFn that delegates to pi-ai's default streamSimple, then patches the
 * final `done` event when the provider returned an unknown finish_reason so
 * pi-agent-core does not prematurely terminate the agent loop.
 */
export const wrappedStreamFn: StreamFn = (model, context, options) => {
  const upstream = streamSimple(model, context, options);
  const downstream = createAssistantMessageEventStream();

  (async () => {
    try {
      for await (const event of upstream) {
        if (event.type === 'done') {
          const message = (event as { message?: unknown }).message as
            | {
                stopReason?: string;
                errorMessage?: string;
                content?: Array<{ type?: string }>;
              }
            | undefined;
          if (message && message.stopReason === 'error') {
            const raw = extractFinishReason(message.errorMessage);
            if (raw) {
              const hasToolCalls = Array.isArray(message.content)
                && message.content.some((c) => c?.type === 'toolCall');
              const mapped = mapUnknownFinishReason(raw, hasToolCalls);
              if (mapped) {
                message.stopReason = mapped;
                message.errorMessage = undefined;
                log(
                  'stream-wrapper',
                  `Rewrote provider finish_reason "${raw}" → stopReason="${mapped}" (hasToolCalls=${hasToolCalls})`,
                );
              } else {
                log(
                  'stream-wrapper',
                  `Kept provider finish_reason "${raw}" as stopReason="error" (intentional block)`,
                );
              }
            }
          }
        }
        downstream.push(event);
      }
    } catch (err) {
      downstream.push({
        type: 'error',
        reason: 'error',
        error: err as never,
      } as never);
    }
  })();

  return downstream;
};
