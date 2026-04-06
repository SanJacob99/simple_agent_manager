import type { CoordinatorEvent } from '../../../shared/run-types';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

export class CompactionHandler implements StreamTransform {
  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;
    if (raw.type !== 'memory_compaction') return;

    emit({ type: 'compaction:start', agentId: '', runId: context.runId } as any);

    // In this layer, retrying is always false — the compaction trigger is not built yet.
    const retrying = false;

    if (retrying) {
      context.textBuffer = '';
      context.reasoningBuffer = '';
      context.toolSummaries = [];
      context.noReplyDetected = false;
      context.messageSuppressed = false;
      context.compactionRetrying = true;
    }

    emit({ type: 'compaction:end', agentId: '', runId: context.runId, retrying } as any);
  }
}
