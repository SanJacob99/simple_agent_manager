import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useSessionStore } from './session-store';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('session-store transcript status', () => {
  beforeEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
    useSessionStore.setState({ storageEngine: null, storageEngines: {}, transcriptStatus: {} } as any);
  });

  afterEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
    useSessionStore.setState({ storageEngine: null, storageEngines: {}, transcriptStatus: {} } as any);
    vi.restoreAllMocks();
  });

  it('tracks loading and ready states while flushing a transcript', async () => {
    const transcript = deferred<any>();
    const meta = {
      sessionKey: 'agent:agent-1:main',
      sessionId: 'sess-1',
      agentId: 'agent-1',
      sessionFile: 'sessions/sess-1.jsonl',
      createdAt: '2026-04-07T12:00:00.000Z',
      updatedAt: '2026-04-07T12:00:00.000Z',
      chatType: 'direct',
      displayName: 'Main session',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      compactionCount: 0,
    };
    const storage = {
      agentId: meta.agentId,
      getTranscript: vi.fn(async () => transcript.promise),
      getSession: vi.fn(async () => meta),
      deleteAllSessions: vi.fn(async () => {}),
    } as any;

    useSessionStore.setState({
      storageEngine: storage,
      storageEngines: { [meta.agentId]: storage },
      sessions: {
        [meta.sessionKey]: {
          id: meta.sessionKey,
          sessionKey: meta.sessionKey,
          sessionId: meta.sessionId,
          agentId: meta.agentId,
          createdAt: Date.parse(meta.createdAt),
          lastMessageAt: Date.parse(meta.updatedAt),
          displayName: meta.displayName,
          messages: [],
          meta,
        },
      },
    } as any);

    const flushPromise = useSessionStore.getState().flushSession(meta.sessionKey);

    expect(useSessionStore.getState().transcriptStatus[meta.sessionKey]).toBe('loading');

    transcript.resolve({
      sessionKey: meta.sessionKey,
      sessionId: meta.sessionId,
      transcriptPath: 'C:/tmp/sess-1.jsonl',
      entries: [],
    });
    await flushPromise;

    expect(useSessionStore.getState().transcriptStatus[meta.sessionKey]).toBe('ready');
  });
});
