import { describe, it, expect, vi } from 'vitest';
import { CompactionHandler } from './compaction-handler';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function compactionEvent(): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: { type: 'memory_compaction', summary: 'Compacted 50 messages' },
  };
}

describe('CompactionHandler', () => {
  it('emits compaction:start and compaction:end on memory_compaction event', () => {
    const handler = new CompactionHandler();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    handler.process(compactionEvent(), ctx, emit);

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toEqual({ type: 'compaction:start', agentId: '', runId: 'run-1' });
    expect(emitted[1]).toEqual({ type: 'compaction:end', agentId: '', runId: 'run-1' });
  });

  it('ignores non-compaction events', () => {
    const handler = new CompactionHandler();
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    handler.process(
      { type: 'stream', runId: 'run-1', event: { type: 'message_start', message: { role: 'assistant' } } },
      ctx,
      emit,
    );

    expect(emit).not.toHaveBeenCalled();
  });
});
