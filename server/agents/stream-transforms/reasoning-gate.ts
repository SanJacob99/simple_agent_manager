import type { CoordinatorEvent } from '../../../shared/run-types';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

export class ReasoningGate implements StreamTransform {
  constructor(private readonly showReasoning: boolean) {}

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;
    if (raw.type !== 'message_update') return;

    const aEvent = raw.assistantMessageEvent;
    if (!aEvent) return;

    switch (aEvent.type) {
      case 'thinking_start':
        if (this.showReasoning) {
          emit({ type: 'reasoning:start', agentId: '', runId: context.runId });
        }
        break;

      case 'thinking_delta':
        if (this.showReasoning) {
          context.reasoningBuffer += aEvent.delta;
          emit({ type: 'reasoning:delta', agentId: '', runId: context.runId, delta: aEvent.delta });
        }
        break;

      case 'thinking_end':
        if (this.showReasoning) {
          emit({ type: 'reasoning:end', agentId: '', runId: context.runId, content: aEvent.content });
        }
        break;
    }
  }
}
