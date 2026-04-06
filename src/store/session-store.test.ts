import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore, type Message } from './session-store';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('session-store', () => {
  beforeEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
  });

  afterEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
    vi.restoreAllMocks();
  });

  it('adds messages to local state immediately even when storage writes are still pending', async () => {
    const deferred = createDeferred();
    const storage = {
      appendEntry: vi.fn(() => deferred.promise),
      updateSessionMeta: vi.fn(async () => {}),
      createSession: vi.fn(async () => {}),
      deleteSession: vi.fn(async () => {}),
      deleteSessionMeta: vi.fn(async () => {}),
      listSessions: vi.fn(async () => []),
      readEntries: vi.fn(async () => []),
      enforceRetention: vi.fn(async () => {}),
    } as any;

    const store = useSessionStore.getState();
    store.bindStorage(storage);
    const sessionId = await store.createSession('Agent', 'openrouter', 'model-1');

    const message: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    const addPromise = store.addMessage(sessionId, message);

    expect(useSessionStore.getState().sessions[sessionId]?.messages).toEqual([message]);

    deferred.resolve();
    await addPromise;
  });
});
