import { describe, it, expect, vi } from 'vitest';
import { ReasoningGate } from './reasoning-gate';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function streamEvent(assistantMessageEvent: any): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: { type: 'message_update', assistantMessageEvent },
  };
}

describe('ReasoningGate', () => {
  it('drops thinking events when showReasoning is false', () => {
    const gate = new ReasoningGate(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    gate.process(
      streamEvent({ type: 'thinking_start', contentIndex: 0, partial: {} }),
      ctx,
      emit,
    );
    gate.process(
      streamEvent({ type: 'thinking_delta', contentIndex: 0, delta: 'hmm', partial: {} }),
      ctx,
      emit,
    );
    gate.process(
      streamEvent({ type: 'thinking_end', contentIndex: 0, content: 'hmm', partial: {} }),
      ctx,
      emit,
    );

    expect(emit).not.toHaveBeenCalled();
    expect(ctx.reasoningBuffer).toBe('');
  });

  it('emits reasoning events and buffers when showReasoning is true', () => {
    const gate = new ReasoningGate(true);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    gate.process(
      streamEvent({ type: 'thinking_start', contentIndex: 0, partial: {} }),
      ctx,
      emit,
    );
    gate.process(
      streamEvent({ type: 'thinking_delta', contentIndex: 0, delta: 'Let me think', partial: {} }),
      ctx,
      emit,
    );
    gate.process(
      streamEvent({ type: 'thinking_end', contentIndex: 0, content: 'Let me think', partial: {} }),
      ctx,
      emit,
    );

    expect(emitted).toHaveLength(3);
    expect(emitted[0]).toEqual({ type: 'reasoning:start', agentId: '', runId: 'run-1' });
    expect(emitted[1]).toEqual({ type: 'reasoning:delta', agentId: '', runId: 'run-1', delta: 'Let me think' });
    expect(emitted[2]).toEqual({ type: 'reasoning:end', agentId: '', runId: 'run-1', content: 'Let me think' });
    expect(ctx.reasoningBuffer).toBe('Let me think');
  });

  it('ignores non-thinking stream events', () => {
    const gate = new ReasoningGate(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    gate.process(
      streamEvent({ type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} }),
      ctx,
      emit,
    );

    expect(emit).not.toHaveBeenCalled();
  });

  it('ignores lifecycle events', () => {
    const gate = new ReasoningGate(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    gate.process(
      { type: 'lifecycle:start', runId: 'run-1', agentId: 'agent-1', sessionId: 'sess-1', startedAt: 1000 },
      ctx,
      emit,
    );

    expect(emit).not.toHaveBeenCalled();
  });
});
