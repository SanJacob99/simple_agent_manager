import { describe, it, expect, vi } from 'vitest';
import { ReplyFilter } from './reply-filter';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function streamEvent(innerEvent: any): CoordinatorEvent {
  return { type: 'stream', runId: 'run-1', event: innerEvent };
}

function messageStart(): CoordinatorEvent {
  return streamEvent({ type: 'message_start', message: { role: 'assistant' } });
}

function textDelta(delta: string): CoordinatorEvent {
  return streamEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta, partial: {} },
  });
}

function textEnd(content: string): CoordinatorEvent {
  return streamEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_end', contentIndex: 0, content, partial: {} },
  });
}

function messageEnd(): CoordinatorEvent {
  return streamEvent({ type: 'message_end', message: { role: 'assistant' } });
}

function messageEndWithText(text: string): CoordinatorEvent {
  return streamEvent({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
    },
  });
}

describe('ReplyFilter', () => {
  it('forwards normal text events after text_end confirms non-NO_REPLY', () => {
    const filter = new ReplyFilter();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    filter.process(messageStart(), ctx, emit);
    filter.process(textDelta('Hello '), ctx, emit);
    filter.process(textDelta('world'), ctx, emit);
    filter.process(textEnd('Hello world'), ctx, emit);
    filter.process(messageEnd(), ctx, emit);

    const types = emitted.map((e) => e.type);
    expect(types).toContain('message:start');
    expect(types.filter((t) => t === 'message:delta')).toHaveLength(2);
    expect(types).toContain('message:end');
    expect(ctx.textBuffer).toBe('Hello world');
    expect(ctx.noReplyDetected).toBe(false);
  });

  it('suppresses message events when text is exactly NO_REPLY', () => {
    const filter = new ReplyFilter();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    filter.process(messageStart(), ctx, emit);
    filter.process(textDelta('NO_REPLY'), ctx, emit);
    filter.process(textEnd('NO_REPLY'), ctx, emit);
    filter.process(messageEnd(), ctx, emit);

    const types = emitted.map((e) => e.type);
    expect(types).not.toContain('message:start');
    expect(types).not.toContain('message:delta');
    expect(types).not.toContain('message:end');
    expect(types).toContain('message:suppressed');
    expect(ctx.noReplyDetected).toBe(true);
    expect(ctx.messageSuppressed).toBe(true);
    expect(ctx.textBuffer).toBe('NO_REPLY');
  });

  it('suppresses when text is no_reply (case insensitive, trimmed)', () => {
    const filter = new ReplyFilter();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    filter.process(messageStart(), ctx, emit);
    filter.process(textDelta('  no_reply  '), ctx, emit);
    filter.process(textEnd('  no_reply  '), ctx, emit);
    filter.process(messageEnd(), ctx, emit);

    expect(ctx.noReplyDetected).toBe(true);
    expect(emitted.some((e) => e.type === 'message:suppressed')).toBe(true);
  });

  it('does NOT suppress partial matches', () => {
    const filter = new ReplyFilter();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    filter.process(messageStart(), ctx, emit);
    filter.process(textDelta('NO_REPLY but more text'), ctx, emit);
    filter.process(textEnd('NO_REPLY but more text'), ctx, emit);
    filter.process(messageEnd(), ctx, emit);

    expect(ctx.noReplyDetected).toBe(false);
    expect(emitted.some((e) => e.type === 'message:start')).toBe(true);
  });

  it('falls back to assistant message_end content when no text deltas were streamed', () => {
    const filter = new ReplyFilter();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    filter.process(messageStart(), ctx, emit);
    filter.process(messageEndWithText('Hello from message end'), ctx, emit);

    expect(ctx.textBuffer).toBe('Hello from message end');
    expect(emitted).toEqual([
      { type: 'message:start', agentId: '', runId: 'run-1', message: { role: 'assistant' } },
      { type: 'message:delta', agentId: '', runId: 'run-1', delta: 'Hello from message end' },
      { type: 'message:end', agentId: '', runId: 'run-1', message: { role: 'assistant', usage: undefined } },
    ]);
  });
});
