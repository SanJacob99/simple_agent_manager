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
        { type: 'user', id: 'e1', parentId: null, timestamp: '2026-04-08T00:00:00.000Z', content: 'Hello' },
        { type: 'assistant', id: 'e2', parentId: 'e1', timestamp: '2026-04-08T00:01:00.000Z', content: 'Hi there, how can I help?' },
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
  it('returns formatted transcript', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main' });
    expect(ctx.sessionRouter.getStatus).toHaveBeenCalledWith('agent:a1:main');
    expect(ctx.storageEngine.resolveTranscriptPath).toHaveBeenCalled();
    expect(ctx.transcriptStore.readTranscript).toHaveBeenCalled();
    expect(result.content[0].text).toContain('Hello');
    expect(result.content[0].text).toContain('Hi there');
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
