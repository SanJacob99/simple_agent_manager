import type { CoordinatorEvent } from '../../../shared/run-types';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

export class CompactionHandler implements StreamTransform {
  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;
    if (raw.type !== 'memory_compaction') return;

    // ToDo: Compaction Trigger — when the auto-retry-after-compaction
    // path is wired, this handler should clear `context.textBuffer`,
    // `context.reasoningBuffer`, and `context.toolSummaries` before the
    // next turn so the partial pre-compaction reply isn't replayed, and
    // re-emit `compaction:end` with a `retrying` flag the frontend can
    // use to suppress the discarded message.
    emit({ type: 'compaction:start', agentId: '', runId: context.runId });
    emit({ type: 'compaction:end', agentId: '', runId: context.runId });
  }
}
