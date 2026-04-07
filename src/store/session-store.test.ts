import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { useSessionStore, type Message } from './session-store';
import { StorageEngine } from '../../server/runtime/storage-engine';
import type { ResolvedStorageConfig } from '../../shared/agent-config';

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeTempConfig(overrides?: Partial<ResolvedStorageConfig>): ResolvedStorageConfig {
  return {
    label: 'Test Storage',
    backendType: 'filesystem',
    storagePath: path.join(
      os.tmpdir(),
      `sam-session-store-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    ),
    sessionRetention: 50,
    memoryEnabled: false,
    dailyMemoryEnabled: false,
    ...overrides,
  };
}

describe('session-store', () => {
  let tempStoragePath: string | null = null;

  beforeEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
    tempStoragePath = null;
  });

  afterEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
    if (tempStoragePath) {
      void fs.rm(tempStoragePath, { recursive: true, force: true });
    }
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

  it('flushes finalized streamed assistant messages so reload restores the final content', async () => {
    const config = makeTempConfig();
    tempStoragePath = config.storagePath;

    const storage = new StorageEngine(config, 'Agent');
    await storage.init();

    const store = useSessionStore.getState();
    store.bindStorage(storage as any);

    const sessionId = await store.createSession('Agent', 'openrouter', 'model-1');
    const messageId = 'assistant-1';

    await store.addMessage(sessionId, {
      id: messageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    });

    store.updateMessage(sessionId, messageId, (message) => ({
      ...message,
      content: 'Final reply',
    }));

    await store.flushSession(sessionId);

    store.resetAllSessions();
    await store.loadSessionsFromDisk();

    expect(useSessionStore.getState().sessions[sessionId]?.messages).toEqual([
      expect.objectContaining({
        id: messageId,
        role: 'assistant',
        content: 'Final reply',
      }),
    ]);
  });
});
