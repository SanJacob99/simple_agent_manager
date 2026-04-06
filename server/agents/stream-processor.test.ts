import { describe, it, expect, vi } from 'vitest';
import { StreamProcessor } from './stream-processor';
import type { RunCoordinator } from './run-coordinator';
import type { AgentConfig } from '../../shared/agent-config';
import type { CoordinatorEvent } from '../../shared/run-types';
import type { ServerEvent } from '../../shared/protocol';

function mockCoordinator(): RunCoordinator & { _listeners: Set<(e: CoordinatorEvent) => void> } {
  const listeners = new Set<(e: CoordinatorEvent) => void>();
  return {
    _listeners: listeners,
    subscribeAll: vi.fn((listener: (e: CoordinatorEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    setRunPayloads: vi.fn(),
  } as any;
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    version: 3,
    name: 'Test Agent',
    description: '',
    tags: [],
    provider: 'openai',
    modelId: 'gpt-4',
    thinkingLevel: 'none',
    systemPrompt: { mode: 'manual', sections: [], assembled: 'Test', userInstructions: 'Test' },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: null,
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    runTimeoutMs: 172800000,
    showReasoning: false,
    verbose: false,
    ...overrides,
  } as AgentConfig;
}

function emitToCoordinator(coordinator: ReturnType<typeof mockCoordinator>, event: CoordinatorEvent) {
  for (const listener of coordinator._listeners) {
    listener(event);
  }
}

describe('StreamProcessor', () => {
  it('processes a full run: start -> text deltas -> end -> assembled payloads', () => {
    const coordinator = mockCoordinator();
    const processor = new StreamProcessor('agent-1', coordinator as any, makeConfig());
    const emitted: ServerEvent[] = [];
    processor.subscribe((e) => emitted.push(e));

    emitToCoordinator(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: { type: 'message_start', message: { role: 'assistant' } },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} },
      },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Hello', partial: {} },
      },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_end',
        message: { role: 'assistant', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 } },
      },
    });

    emitToCoordinator(coordinator, {
      type: 'lifecycle:end',
      runId: 'run-1',
      status: 'ok',
      startedAt: 1000,
      endedAt: 2000,
      payloads: [],
    });

    const types = emitted.map((e) => e.type);
    expect(types).toContain('lifecycle:start');
    expect(types).toContain('message:start');
    expect(types).toContain('message:delta');
    expect(types).toContain('message:end');
    expect(types).toContain('lifecycle:end');
    expect(types).toContain('agent:end');

    const endEvent = emitted.find((e) => e.type === 'lifecycle:end') as any;
    expect(endEvent.payloads).toEqual([{ type: 'text', content: 'Hello' }]);
    expect(coordinator.setRunPayloads).toHaveBeenCalled();
  });

  it('suppresses NO_REPLY and emits message:suppressed', () => {
    const coordinator = mockCoordinator();
    const processor = new StreamProcessor('agent-1', coordinator as any, makeConfig());
    const emitted: ServerEvent[] = [];
    processor.subscribe((e) => emitted.push(e));

    emitToCoordinator(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: { type: 'message_start', message: { role: 'assistant' } },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'NO_REPLY', partial: {} },
      },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'NO_REPLY', partial: {} },
      },
    });

    const types = emitted.map((e) => e.type);
    expect(types).not.toContain('message:start');
    expect(types).not.toContain('message:delta');
    expect(types).toContain('message:suppressed');
  });

  it('forwards reasoning events when showReasoning is true', () => {
    const coordinator = mockCoordinator();
    const processor = new StreamProcessor('agent-1', coordinator as any, makeConfig({ showReasoning: true }));
    const emitted: ServerEvent[] = [];
    processor.subscribe((e) => emitted.push(e));

    emitToCoordinator(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_start', contentIndex: 0, partial: {} },
      },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm', partial: {} },
      },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: 'hmm', partial: {} },
      },
    });

    const types = emitted.map((e) => e.type);
    expect(types).toContain('reasoning:start');
    expect(types).toContain('reasoning:delta');
    expect(types).toContain('reasoning:end');
  });

  it('cleans up run context on lifecycle:end', () => {
    const coordinator = mockCoordinator();
    const processor = new StreamProcessor('agent-1', coordinator as any, makeConfig());
    processor.subscribe(() => {});

    emitToCoordinator(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    expect(processor.hasRunContext('run-1')).toBe(true);

    emitToCoordinator(coordinator, {
      type: 'lifecycle:end',
      runId: 'run-1',
      status: 'ok',
      startedAt: 1000,
      endedAt: 2000,
      payloads: [],
    });

    expect(processor.hasRunContext('run-1')).toBe(false);
  });

  it('stamps agentId on all emitted events', () => {
    const coordinator = mockCoordinator();
    const processor = new StreamProcessor('agent-1', coordinator as any, makeConfig());
    const emitted: ServerEvent[] = [];
    processor.subscribe((e) => emitted.push(e));

    emitToCoordinator(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    for (const event of emitted) {
      expect((event as any).agentId).toBe('agent-1');
    }
  });
});
