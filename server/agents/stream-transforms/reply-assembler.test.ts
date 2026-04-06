import { describe, it, expect, vi } from 'vitest';
import { ReplyAssembler } from './reply-assembler';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function lifecycleEnd(): CoordinatorEvent {
  return {
    type: 'lifecycle:end',
    runId: 'run-1',
    status: 'ok',
    startedAt: 1000,
    endedAt: 2000,
    payloads: [],
    usage: undefined,
  };
}

function lifecycleError(): CoordinatorEvent {
  return {
    type: 'lifecycle:error',
    runId: 'run-1',
    status: 'error',
    error: { code: 'internal', message: 'boom', retriable: false },
    startedAt: 1000,
    endedAt: 2000,
  };
}

function messageEndEvent(usage?: any): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: { type: 'message_end', message: { role: 'assistant', usage } },
  };
}

describe('ReplyAssembler', () => {
  it('assembles text payload from textBuffer', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Hello world';
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([{ type: 'text', content: 'Hello world' }]);
  });

  it('strips NO_REPLY text payload (late detection)', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = '  NO_REPLY  ';
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads.filter((p) => p.type === 'text')).toHaveLength(0);
  });

  it('includes reasoning payload when showReasoning is true', () => {
    const assembler = new ReplyAssembler(true, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Answer';
    ctx.reasoningBuffer = 'I thought about it';
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([
      { type: 'text', content: 'Answer' },
      { type: 'reasoning', content: 'I thought about it' },
    ]);
  });

  it('omits reasoning payload when showReasoning is false', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Answer';
    ctx.reasoningBuffer = 'I thought about it';
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([{ type: 'text', content: 'Answer' }]);
  });

  it('includes tool summaries when verbose is true', () => {
    const assembler = new ReplyAssembler(false, true, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Done';
    ctx.toolSummaries = [
      { toolCallId: 'tc-1', toolName: 'search', resultText: 'found 3', isError: false },
    ];
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([
      { type: 'text', content: 'Done' },
      { type: 'tool_summary', content: 'search: found 3' },
    ]);
  });

  it('emits fallback error when no payloads and a tool errored', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'NO_REPLY';
    ctx.toolSummaries = [
      { toolCallId: 'tc-1', toolName: 'search', resultText: 'failed', isError: true },
    ];
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([{ type: 'error', content: 'Tool execution failed' }]);
  });

  it('calls setRunPayloads with assembled payloads and usage', () => {
    const setRunPayloads = vi.fn();
    const assembler = new ReplyAssembler(false, false, setRunPayloads);
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Hello';
    ctx.usage = { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 };
    const emit = vi.fn();

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(setRunPayloads).toHaveBeenCalledWith('run-1', ctx.payloads, ctx.usage);
  });

  it('emits enriched lifecycle:end with payloads and usage', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Hello';
    ctx.usage = { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 };
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    const endEvent = emitted.find((e) => e.type === 'lifecycle:end') as any;
    expect(endEvent).toBeDefined();
    expect(endEvent.payloads).toEqual([{ type: 'text', content: 'Hello' }]);
    expect(endEvent.usage).toEqual(ctx.usage);
  });

  it('captures usage from message_end events', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    const usage = { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 };
    assembler.process(messageEndEvent(usage), ctx, emit);

    expect(ctx.usage).toEqual(usage);
  });

  it('passes lifecycle:error through unchanged', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleError(), ctx, emit);

    const errorEvent = emitted.find((e) => e.type === 'lifecycle:error') as any;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error.message).toBe('boom');
  });
});
