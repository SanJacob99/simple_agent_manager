import { describe, expect, it, vi } from 'vitest';
import type { SessionToolContext } from './session-tools';
import { createSessionTools } from './session-tools';
import type { SessionStoreEntry } from '../../shared/storage-types';

function mockSession(overrides: Partial<SessionStoreEntry> = {}): SessionStoreEntry {
  return {
    sessionKey: 'agent:a1:main',
    sessionId: 'sid-1',
    agentId: 'a1',
    sessionFile: 'sessions/sid-1.jsonl',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T01:00:00.000Z',
    chatType: 'direct',
    inputTokens: 100,
    outputTokens: 50,
    totalTokens: 150,
    contextTokens: 120,
    cacheRead: 0,
    cacheWrite: 0,
    totalEstimatedCostUsd: 0.001,
    compactionCount: 0,
    ...overrides,
  };
}

function createMockContext(overrides: Partial<SessionToolContext> = {}): SessionToolContext {
  return {
    callerSessionKey: 'agent:a1:main',
    callerAgentId: 'a1',
    callerRunId: 'run-1',
    sessionRouter: {
      listSessions: vi.fn().mockResolvedValue([mockSession()]),
      getStatus: vi.fn().mockResolvedValue(mockSession()),
      updateAfterTurn: vi.fn().mockResolvedValue(undefined),
    } as any,
    storageEngine: {
      resolveTranscriptPath: vi.fn().mockReturnValue('/data/sessions/sid-1.jsonl'),
    } as any,
    transcriptStore: {
      readTranscript: vi.fn().mockReturnValue([
        {
          type: 'message',
          id: 'e1',
          parentId: null,
          timestamp: '2026-04-08T00:00:00.000Z',
          message: { role: 'user', content: 'Hello' },
        },
        {
          type: 'message',
          id: 'e2',
          parentId: 'e1',
          timestamp: '2026-04-08T00:01:00.000Z',
          message: { role: 'assistant', content: 'Hi there, how can I help?' },
        },
      ]),
    } as any,
    coordinator: {
      dispatch: vi.fn().mockResolvedValue({ runId: 'run-2', sessionId: 'sid-1', acceptedAt: Date.now() }),
      wait: vi.fn().mockResolvedValue({
        runId: 'run-2',
        status: 'ok',
        phase: 'completed',
        acceptedAt: Date.now(),
        payloads: [{ type: 'text', content: 'Reply from agent' }],
      }),
    } as any,
    subAgentRegistry: {
      spawn: vi.fn().mockReturnValue({
        subAgentId: 'sub-1',
        parentSessionKey: 'agent:a1:main',
        parentRunId: 'run-1',
        targetAgentId: 'a1',
        sessionKey: 'sub:agent:a1:main:uuid',
        runId: 'run-3',
        status: 'running',
        startedAt: Date.now(),
      }),
      listForParent: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      kill: vi.fn().mockReturnValue(false),
      setYieldPending: vi.fn(),
    } as any,
    coordinatorLookup: vi.fn().mockReturnValue(null),
    subAgentSpawning: true,
    enabledToolNames: [
      'sessions_list',
      'sessions_history',
      'sessions_send',
      'sessions_spawn',
      'sessions_yield',
      'subagents',
      'session_status',
    ],
    ...overrides,
  };
}

describe('createSessionTools', () => {
  it('returns 7 tools when subAgentSpawning is true', () => {
    const ctx = createMockContext({ subAgentSpawning: true });
    const tools = createSessionTools(ctx);
    expect(tools).toHaveLength(7);

    const names = tools.map((t) => t.name);
    expect(names).toContain('sessions_list');
    expect(names).toContain('sessions_history');
    expect(names).toContain('sessions_send');
    expect(names).toContain('sessions_spawn');
    expect(names).toContain('sessions_yield');
    expect(names).toContain('subagents');
    expect(names).toContain('session_status');
  });

  it('returns 4 tools when subAgentSpawning is false', () => {
    const ctx = createMockContext({ subAgentSpawning: false });
    const tools = createSessionTools(ctx);
    expect(tools).toHaveLength(4);

    const names = tools.map((t) => t.name);
    expect(names).toContain('sessions_list');
    expect(names).toContain('sessions_history');
    expect(names).toContain('sessions_send');
    expect(names).toContain('session_status');
    expect(names).not.toContain('sessions_spawn');
    expect(names).not.toContain('sessions_yield');
    expect(names).not.toContain('subagents');
  });

  it('returns only the explicitly enabled session tools', () => {
    const ctx = createMockContext({
      enabledToolNames: ['sessions_list', 'session_status'],
      subAgentSpawning: true,
    });
    const tools = createSessionTools(ctx);

    expect(tools.map((tool) => tool.name)).toEqual([
      'sessions_list',
      'session_status',
    ]);
  });

  it('does not return sub-agent tools unless they are explicitly enabled', () => {
    const ctx = createMockContext({
      enabledToolNames: ['sessions_list', 'session_status'],
      subAgentSpawning: true,
    });
    const tools = createSessionTools(ctx);

    expect(tools.map((tool) => tool.name)).not.toContain('sessions_spawn');
    expect(tools.map((tool) => tool.name)).not.toContain('sessions_yield');
    expect(tools.map((tool) => tool.name)).not.toContain('subagents');
  });
});

describe('sessions_list', () => {
  it('returns session data', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    const result = await tool.execute('call-1', {});
    expect(ctx.sessionRouter.listSessions).toHaveBeenCalled();
    expect(result.content[0].text).toContain('agent:a1:main');
  });
});

describe('sessions_history', () => {
  it('returns JSON with entries newest-first', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main' });
    expect(ctx.sessionRouter.getStatus).toHaveBeenCalledWith('agent:a1:main');
    expect(ctx.storageEngine.resolveTranscriptPath).toHaveBeenCalled();
    expect(ctx.transcriptStore.readTranscript).toHaveBeenCalled();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sessionKey).toBe('agent:a1:main');
    expect(Array.isArray(parsed.entries)).toBe(true);
  });
});

describe('session_status', () => {
  it('returns session metadata', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'session_status')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main' });
    expect(ctx.sessionRouter.getStatus).toHaveBeenCalledWith('agent:a1:main');

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sessionKey).toBe('agent:a1:main');
    expect(parsed.totalTokens).toBe(150);
  });
});

describe('sessions_send', () => {
  it('dispatches without waiting when wait is false', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_send')!;

    const result = await tool.execute('call-1', {
      sessionKey: 'agent:a1:main',
      message: 'Hello agent',
      wait: false,
    });
    expect(ctx.coordinator.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: 'agent:a1:main', text: 'Hello agent' }),
    );
    expect(ctx.coordinator.wait).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain('run-2');
  });

  it('dispatches and waits when wait is true', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_send')!;

    const result = await tool.execute('call-1', {
      sessionKey: 'agent:a1:main',
      message: 'Hello agent',
      wait: true,
    });
    expect(ctx.coordinator.dispatch).toHaveBeenCalled();
    expect(ctx.coordinator.wait).toHaveBeenCalledWith('run-2', undefined);
    expect(result.content[0].text).toContain('Reply from agent');
  });
});

describe('sessions_spawn', () => {
  it('creates sub-agent and registers it', async () => {
    const targetCoordinator = {
      dispatch: vi.fn().mockResolvedValue({ runId: 'run-3', sessionId: 'sid-2', acceptedAt: Date.now() }),
      wait: vi.fn().mockResolvedValue({
        runId: 'run-3',
        status: 'ok',
        phase: 'completed',
        acceptedAt: Date.now(),
        payloads: [{ type: 'text', content: 'Sub-agent result' }],
      }),
    };

    const ctx = createMockContext({
      coordinatorLookup: vi.fn().mockReturnValue(targetCoordinator),
    });
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_spawn')!;

    const result = await tool.execute('call-1', {
      targetAgentId: 'a2',
      message: 'Do the task',
      wait: false,
    });

    expect(ctx.coordinatorLookup).toHaveBeenCalledWith('a2');
    expect(targetCoordinator.dispatch).toHaveBeenCalled();
    expect(ctx.subAgentRegistry.spawn).toHaveBeenCalled();
    expect(result.content[0].text).toContain('sub:');
  });
});

describe('sessions_list filters', () => {
  it('matches label substring case-insensitively', async () => {
    const ctx = createMockContext();
    (ctx.sessionRouter.listSessions as any).mockResolvedValue([
      mockSession({ sessionKey: 'agent:a1:s1', displayName: 'Daily Standup' }),
      mockSession({ sessionKey: 'agent:a1:s2', displayName: 'Bug Triage' }),
      mockSession({ sessionKey: 'agent:a1:s3', displayName: undefined }),
    ]);

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    const result = await tool.execute('call-1', { label: 'standup' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.map((s: any) => s.sessionKey)).toEqual(['agent:a1:s1']);
  });

  it('rejects cross-agent agent filter with explicit text', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    const result = await tool.execute('call-1', { agent: 'other-agent' });

    expect(result.content[0].text).toContain('Cross-agent listing is not yet supported');
  });

  it('accepts agent filter when it equals callerAgentId', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    const result = await tool.execute('call-1', { agent: 'a1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
  });

  it('includes preview text and messageCount when preview=true', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue([
      { type: 'message', id: 'e1', message: { role: 'user', content: 'Tell me a long story about cats' }, timestamp: '2026-04-08T00:00:00.000Z' },
      { type: 'message', id: 'e2', message: { role: 'assistant', content: 'Once upon a time...' }, timestamp: '2026-04-08T00:01:00.000Z' },
      { type: 'message', id: 'e3', message: { role: 'user', content: 'Continue please' }, timestamp: '2026-04-08T00:02:00.000Z' },
    ]);

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    const result = await tool.execute('call-1', { preview: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed[0].preview).toBe('Tell me a long story about cats');
    expect(parsed[0].messageCount).toBe(3);
  });

  it('caps preview reads at 50 sessions', async () => {
    const ctx = createMockContext();
    const sessions = Array.from({ length: 75 }, (_, i) =>
      mockSession({ sessionKey: `agent:a1:s${i}`, sessionId: `sid-${i}` }),
    );
    (ctx.sessionRouter.listSessions as any).mockResolvedValue(sessions);
    (ctx.transcriptStore.readTranscript as any).mockReturnValue([]);

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    await tool.execute('call-1', { preview: true });

    expect(ctx.transcriptStore.readTranscript).toHaveBeenCalledTimes(50);
  });
});

function makeTranscriptEntries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'message',
    id: `e${i + 1}`,
    parentId: i === 0 ? null : `e${i}`,
    timestamp: new Date(Date.parse('2026-04-08T00:00:00.000Z') + i * 60_000).toISOString(),
    message: {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1} body`,
    },
  }));
}

describe('sessions_history pagination', () => {
  it('returns the most recent entries newest-first by default', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue(makeTranscriptEntries(50));

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.entries[0].id).toBe('e50');
    expect(parsed.entries.at(-1).id).toBe('e31');
    expect(parsed.entries).toHaveLength(20);
    expect(parsed.nextCursor).toBe('e31');
    expect(parsed.totalEntries).toBe(50);
  });

  it('respects the before cursor', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue(makeTranscriptEntries(50));

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main', before: 'e31', limit: 10 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.entries[0].id).toBe('e30');
    expect(parsed.entries.at(-1).id).toBe('e21');
    expect(parsed.nextCursor).toBe('e21');
  });

  it('returns explicit error for unknown cursor', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue(makeTranscriptEntries(5));

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main', before: 'nope' });
    expect(result.content[0].text).toContain('Cursor not found');
  });

  it('truncates with truncated:true when total budget is exceeded', async () => {
    const ctx = createMockContext();
    const big = 'X'.repeat(2000);
    (ctx.transcriptStore.readTranscript as any).mockReturnValue(
      Array.from({ length: 30 }, (_, i) => ({
        type: 'message',
        id: `e${i + 1}`,
        parentId: i === 0 ? null : `e${i}`,
        timestamp: new Date(Date.parse('2026-04-08T00:00:00.000Z') + i * 60_000).toISOString(),
        message: { role: 'assistant', content: big },
      })),
    );

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main', limit: 30 });
    const parsed = JSON.parse(result.content[0].text);

    // Each entry text capped at 500 + JSON overhead. Budget = 12_000 chars; we should
    // get fewer than 30 entries back and truncated must be true with a valid cursor.
    expect(parsed.entries.length).toBeLessThan(30);
    expect(parsed.truncated).toBe(true);
    expect(parsed.nextCursor).toBeDefined();
  });

  it('excludes tool results when includeToolResults is false', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue([
      { type: 'message', id: 'e1', message: { role: 'user', content: 'Hi' }, timestamp: '2026-04-08T00:00:00.000Z' },
      { type: 'toolResult', id: 'e2', toolName: 'web_search', content: [{ type: 'text', text: 'long result' }], timestamp: '2026-04-08T00:00:30.000Z' },
      { type: 'message', id: 'e3', message: { role: 'assistant', content: 'Done' }, timestamp: '2026-04-08T00:01:00.000Z' },
    ]);

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main', includeToolResults: false });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.entries.map((e: any) => e.id)).toEqual(['e3', 'e1']);
    expect(parsed.totalEntries).toBe(2);
  });
});
