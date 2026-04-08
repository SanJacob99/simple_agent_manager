import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore, type Message } from './session-store';
import type { SessionStoreEntry } from '../../shared/storage-types';

const RUN_DIAGNOSTIC_CUSTOM_TYPE = 'sam.run_diagnostic';

function makeMeta(overrides?: Partial<SessionStoreEntry>): SessionStoreEntry {
  return {
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
    ...overrides,
  };
}

describe('session-store', () => {
  beforeEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
    useSessionStore.setState({ storageEngine: null, storageEngines: {} } as any);
  });

  afterEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
    useSessionStore.setState({ storageEngine: null, storageEngines: {} } as any);
    vi.restoreAllMocks();
  });

  it('creates sessions from routed backend metadata and keys them by sessionKey', async () => {
    const meta = makeMeta();
    const storage = {
      agentId: meta.agentId,
      routeSession: vi.fn(async () => ({
        sessionKey: meta.sessionKey,
        sessionId: meta.sessionId,
        transcriptPath: 'C:/tmp/sess-1.jsonl',
        created: true,
        reset: false,
      })),
      getSession: vi.fn(async () => meta),
      deleteSession: vi.fn(async () => {}),
      listSessions: vi.fn(async () => []),
      deleteAllSessions: vi.fn(async () => {}),
    } as any;

    const store = useSessionStore.getState();
    store.bindStorage(storage);
    const sessionKey = await store.createSession('agent-1', 'openrouter', 'model-1');

    expect(sessionKey).toBe(meta.sessionKey);
    expect(storage.routeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        subKey: expect.stringMatching(/^session-/),
      }),
    );
    expect(useSessionStore.getState().sessions[sessionKey]).toEqual(
      expect.objectContaining({
        id: meta.sessionKey,
        sessionKey: meta.sessionKey,
        sessionId: meta.sessionId,
        agentId: 'agent-1',
      }),
    );
  });

  it('adds messages to local state without persisting transcript writes from the frontend', async () => {
    const meta = makeMeta();
    const storage = {
      agentId: meta.agentId,
      routeSession: vi.fn(async () => ({
        sessionKey: meta.sessionKey,
        sessionId: meta.sessionId,
        transcriptPath: 'C:/tmp/sess-1.jsonl',
        created: true,
        reset: false,
      })),
      getSession: vi.fn(async () => meta),
      getTranscript: vi.fn(async () => ({ sessionKey: meta.sessionKey, sessionId: meta.sessionId, transcriptPath: 'x', entries: [] })),
      deleteSession: vi.fn(async () => {}),
      listSessions: vi.fn(async () => []),
      resetSession: vi.fn(async () => ({
        sessionKey: meta.sessionKey,
        sessionId: 'sess-2',
        transcriptPath: 'C:/tmp/sess-2.jsonl',
        created: false,
        reset: true,
      })),
      deleteAllSessions: vi.fn(async () => {}),
    } as any;

    const store = useSessionStore.getState();
    store.bindStorage(storage);
    const sessionKey = await store.createSession('agent-1', 'openrouter', 'model-1');
    const message: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    await store.addMessage(sessionKey, message);

    expect(useSessionStore.getState().sessions[sessionKey]?.messages).toEqual([message]);
    expect(storage.getTranscript).not.toHaveBeenCalled();
    expect(storage.resetSession).not.toHaveBeenCalled();
  });

  it('loads session metadata first and refreshes transcript entries on flush', async () => {
    const meta = makeMeta();
    const storage = {
      agentId: meta.agentId,
      listSessions: vi.fn(async () => [meta]),
      getSession: vi.fn(async () => meta),
      getTranscript: vi.fn(async () => ({
        sessionKey: meta.sessionKey,
        sessionId: meta.sessionId,
        transcriptPath: 'C:/tmp/sess-1.jsonl',
        entries: [
          {
            type: 'message',
            id: 'assistant-1',
            parentId: null,
            timestamp: '2026-04-07T12:00:01.000Z',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Final reply' }],
              usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
              timestamp: Date.parse('2026-04-07T12:00:01.000Z'),
            },
          },
        ],
      })),
      deleteAllSessions: vi.fn(async () => {}),
    } as any;

    const store = useSessionStore.getState();
    store.bindStorage(storage);
    await store.loadSessionsFromDisk();

    expect(useSessionStore.getState().sessions[meta.sessionKey]?.messages).toEqual([]);

    await store.flushSession(meta.sessionKey);

    expect(useSessionStore.getState().sessions[meta.sessionKey]?.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Final reply',
      }),
    ]);
  });

  it('hydrates persisted run diagnostics from custom transcript entries', async () => {
    const meta = makeMeta();
    const storage = {
      agentId: meta.agentId,
      listSessions: vi.fn(async () => [meta]),
      getSession: vi.fn(async () => meta),
      getTranscript: vi.fn(async () => ({
        sessionKey: meta.sessionKey,
        sessionId: meta.sessionId,
        transcriptPath: 'C:/tmp/sess-1.jsonl',
        entries: [
          {
            type: 'custom',
            id: 'diag-1',
            parentId: null,
            timestamp: '2026-04-07T12:00:02.000Z',
            customType: RUN_DIAGNOSTIC_CUSTOM_TYPE,
            data: {
              kind: 'run_error',
              runId: 'run-1',
              sessionId: meta.sessionId,
              code: 'internal',
              message: 'Model failed',
              phase: 'running',
              retriable: false,
              createdAt: Date.parse('2026-04-07T12:00:02.000Z'),
            },
          },
        ],
      })),
      deleteAllSessions: vi.fn(async () => {}),
    } as any;

    const store = useSessionStore.getState();
    store.bindStorage(storage);
    await store.loadSessionsFromDisk();
    await store.flushSession(meta.sessionKey);

    expect(useSessionStore.getState().sessions[meta.sessionKey]?.messages).toEqual([
      expect.objectContaining({
        id: 'diag-1',
        role: 'assistant',
        kind: 'diagnostic',
        content: 'Diagnostic (running/internal): Model failed',
      }),
    ]);
  });

  it('hydrates transcript messages when selecting an existing session', async () => {
    const meta = makeMeta();
    const storage = {
      agentId: meta.agentId,
      listSessions: vi.fn(async () => [meta]),
      getSession: vi.fn(async () => meta),
      getTranscript: vi.fn(async () => ({
        sessionKey: meta.sessionKey,
        sessionId: meta.sessionId,
        transcriptPath: 'C:/tmp/sess-1.jsonl',
        entries: [
          {
            type: 'message',
            id: 'user-1',
            parentId: null,
            timestamp: '2026-04-07T12:00:00.000Z',
            message: {
              role: 'user',
              content: 'Hello again',
              timestamp: Date.parse('2026-04-07T12:00:00.000Z'),
            },
          },
          {
            type: 'message',
            id: 'assistant-1',
            parentId: 'user-1',
            timestamp: '2026-04-07T12:00:01.000Z',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Welcome back' }],
              usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
              timestamp: Date.parse('2026-04-07T12:00:01.000Z'),
            },
          },
        ],
      })),
      deleteAllSessions: vi.fn(async () => {}),
    } as any;

    const store = useSessionStore.getState();
    store.bindStorage(storage);
    await store.loadSessionsFromDisk();

    store.setActiveSession(meta.agentId, meta.sessionKey);

    await waitFor(() => {
      expect(useSessionStore.getState().sessions[meta.sessionKey]?.messages).toEqual([
        expect.objectContaining({
          id: 'user-1',
          role: 'user',
          content: 'Hello again',
        }),
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
          content: 'Welcome back',
        }),
      ]);
    });
  });

  it('rehydrates transcript messages for the already-active session when sessions reload from disk', async () => {
    const meta = makeMeta();
    const storage = {
      agentId: meta.agentId,
      listSessions: vi.fn(async () => [meta]),
      getSession: vi.fn(async () => meta),
      getTranscript: vi.fn(async () => ({
        sessionKey: meta.sessionKey,
        sessionId: meta.sessionId,
        transcriptPath: 'C:/tmp/sess-1.jsonl',
        entries: [
          {
            type: 'message',
            id: 'assistant-1',
            parentId: null,
            timestamp: '2026-04-07T12:00:01.000Z',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Persisted reply' }],
              usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
              timestamp: Date.parse('2026-04-07T12:00:01.000Z'),
            },
          },
        ],
      })),
      deleteAllSessions: vi.fn(async () => {}),
    } as any;

    useSessionStore.setState({
      activeSessionKey: { [meta.agentId]: meta.sessionKey },
    } as any);

    const store = useSessionStore.getState();
    store.bindStorage(storage);
    await store.loadSessionsFromDisk();

    await waitFor(() => {
      expect(useSessionStore.getState().sessions[meta.sessionKey]?.messages).toEqual([
        expect.objectContaining({
          id: 'assistant-1',
          role: 'assistant',
          content: 'Persisted reply',
        }),
      ]);
    });
  });

  it('resets the active transcript via the backend when clearing messages', async () => {
    const initialMeta = makeMeta();
    const resetMeta = makeMeta({
      sessionId: 'sess-2',
      sessionFile: 'sessions/sess-2.jsonl',
      updatedAt: '2026-04-07T12:05:00.000Z',
    });

    const storage = {
      agentId: initialMeta.agentId,
      resetSession: vi.fn(async () => ({
        sessionKey: initialMeta.sessionKey,
        sessionId: resetMeta.sessionId,
        transcriptPath: 'C:/tmp/sess-2.jsonl',
        created: false,
        reset: true,
      })),
      getSession: vi.fn(async () => resetMeta),
      deleteAllSessions: vi.fn(async () => {}),
    } as any;

    useSessionStore.setState({
      sessions: {
        [initialMeta.sessionKey]: {
          id: initialMeta.sessionKey,
          sessionKey: initialMeta.sessionKey,
          sessionId: initialMeta.sessionId,
          agentId: initialMeta.agentId,
          createdAt: new Date(initialMeta.createdAt).getTime(),
          lastMessageAt: new Date(initialMeta.updatedAt).getTime(),
          displayName: initialMeta.displayName!,
          messages: [{ id: 'm1', role: 'user', content: 'Hello', timestamp: Date.now() }],
          meta: initialMeta,
        },
      },
      activeSessionKey: {},
      storageEngine: storage,
    } as any);

    await useSessionStore.getState().clearSessionMessages(initialMeta.sessionKey);

    const session = useSessionStore.getState().sessions[initialMeta.sessionKey];
    expect(storage.resetSession).toHaveBeenCalledWith(initialMeta.sessionKey);
    expect(session.messages).toEqual([]);
    expect(session.sessionId).toBe('sess-2');
  });
});
