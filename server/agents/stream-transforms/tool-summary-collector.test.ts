import { describe, it, expect, vi } from 'vitest';
import { ToolSummaryCollector } from './tool-summary-collector';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function toolStartEvent(toolCallId: string, toolName: string): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: { type: 'tool_execution_start', toolCallId, toolName, args: {} },
  };
}

function toolEndEvent(
  toolCallId: string,
  toolName: string,
  resultText: string,
  isError = false,
): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: {
      type: 'tool_execution_end',
      toolCallId,
      toolName,
      result: { content: [{ type: 'text', text: resultText }] },
      isError,
    },
  };
}

describe('ToolSummaryCollector', () => {
  it('always records tool results in context', () => {
    const collector = new ToolSummaryCollector(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    collector.process(toolEndEvent('tc-1', 'search', 'found 3 results'), ctx, emit);

    expect(ctx.toolSummaries).toHaveLength(1);
    expect(ctx.toolSummaries[0]).toEqual({
      toolCallId: 'tc-1',
      toolName: 'search',
      resultText: 'found 3 results',
      isError: false,
    });
  });

  it('emits tool:start and tool:end events always', () => {
    const collector = new ToolSummaryCollector(false);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    collector.process(toolStartEvent('tc-1', 'search'), ctx, emit);
    collector.process(toolEndEvent('tc-1', 'search', 'found 3'), ctx, emit);

    expect(emitted.some((e) => e.type === 'tool:start')).toBe(true);
    expect(emitted.some((e) => e.type === 'tool:end')).toBe(true);
  });

  it('does NOT emit tool:summary when verbose is false', () => {
    const collector = new ToolSummaryCollector(false);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    collector.process(toolEndEvent('tc-1', 'search', 'found 3'), ctx, emit);

    expect(emitted.some((e) => e.type === 'tool:summary')).toBe(false);
  });

  it('emits tool:summary when verbose is true', () => {
    const collector = new ToolSummaryCollector(true);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    collector.process(toolEndEvent('tc-1', 'search', 'found 3 results'), ctx, emit);

    const summary = emitted.find((e) => e.type === 'tool:summary') as any;
    expect(summary).toBeDefined();
    expect(summary.toolName).toBe('search');
    expect(summary.summary).toBe('found 3 results');
  });

  it('truncates summary at 500 chars', () => {
    const collector = new ToolSummaryCollector(true);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    const longResult = 'x'.repeat(1000);
    collector.process(toolEndEvent('tc-1', 'search', longResult), ctx, emit);

    const summary = emitted.find((e) => e.type === 'tool:summary') as any;
    expect(summary.summary).toHaveLength(500);
  });

  it('records isError flag on tool summaries', () => {
    const collector = new ToolSummaryCollector(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    collector.process(toolEndEvent('tc-1', 'search', 'not found', true), ctx, emit);

    expect(ctx.toolSummaries[0].isError).toBe(true);
  });
});
