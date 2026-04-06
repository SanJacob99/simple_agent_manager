import type { CoordinatorEvent, RunPayload, RunUsage } from '../../../shared/run-types';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

const NO_REPLY_PATTERN = /^no_reply$/i;

export type SetRunPayloadsFn = (runId: string, payloads: RunPayload[], usage?: RunUsage) => void;

export class ReplyAssembler implements StreamTransform {
  constructor(
    private readonly showReasoning: boolean,
    private readonly verbose: boolean,
    private readonly setRunPayloads: SetRunPayloadsFn,
  ) {}

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    // Capture usage from message_end
    if (event.type === 'stream') {
      const raw = event.event as any;
      if (raw.type === 'message_end') {
        const usage = raw.message?.usage;
        if (usage) {
          context.usage = {
            input: usage.input ?? 0,
            output: usage.output ?? 0,
            cacheRead: usage.cacheRead ?? 0,
            cacheWrite: usage.cacheWrite ?? 0,
            totalTokens: usage.totalTokens ?? 0,
          };
        }
      }
      return;
    }

    if (event.type === 'lifecycle:error') {
      emit({
        type: 'lifecycle:error',
        agentId: '',
        runId: event.runId,
        status: 'error',
        error: event.error,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
      } as any);
      return;
    }

    if (event.type === 'lifecycle:end') {
      const payloads: RunPayload[] = [];

      // 1. Text payload (skip if empty or NO_REPLY)
      const text = context.textBuffer.trim();
      if (text && !NO_REPLY_PATTERN.test(text)) {
        payloads.push({ type: 'text', content: context.textBuffer });
      }

      // 2. Reasoning payload
      if (this.showReasoning && context.reasoningBuffer) {
        payloads.push({ type: 'reasoning', content: context.reasoningBuffer });
      }

      // 3. Tool summaries
      if (this.verbose) {
        for (const ts of context.toolSummaries) {
          payloads.push({ type: 'tool_summary', content: `${ts.toolName}: ${ts.resultText}` });
        }
      }

      // 4. Fallback error
      if (payloads.length === 0 && context.toolSummaries.some((ts) => ts.isError)) {
        payloads.push({ type: 'error', content: 'Tool execution failed' });
      }

      context.payloads = payloads;

      // Push to coordinator for wait() callers
      this.setRunPayloads(context.runId, payloads, context.usage);

      // Emit enriched lifecycle:end
      emit({
        type: 'lifecycle:end',
        agentId: '',
        runId: event.runId,
        status: 'ok',
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        payloads,
        usage: context.usage,
      } as any);
      return;
    }
  }
}
