import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { useSessionStore, type Message } from './session-store';
import { StorageEngine } from '../../server/runtime/storage-engine';
import type { ResolvedStorageConfig } from '../../shared/agent-config';

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

  it('creates sessions from backend-managed metadata instead of generating local file ids', async () => {
    const storage = {
      createManagedSession: vi.fn(async () => ({
        sessionId: 'backend-session-id',
        sessionKey: 'backend-session-id',
        agentName: 'Agent',
        llmSlug: 'openrouter/model-1',
        startedAt: '2026-04-06T12:00:00.000Z',
        updatedAt: '2026-04-06T12:00:00.000Z',
        sessionFile: 'sessions/backend-session-id.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      })),
      deleteSession: vi.fn(async () => {}),
      listSessions: vi.fn(async () => []),
      readEntries: vi.fn(async () => []),
    } as any;

    const store = useSessionStore.getState();
    store.bindStorage(storage);
    const sessionId = await store.createSession('Agent', 'openrouter', 'model-1');

    expect(sessionId).toBe('backend-session-id');
    expect(storage.createManagedSession).toHaveBeenCalledWith('openrouter/model-1');
    expect(useSessionStore.getState().sessions[sessionId]).toEqual(
      expect.objectContaining({
        id: 'backend-session-id',
        agentName: 'Agent',
        llmSlug: 'openrouter/model-1',
      }),
    );
  });

  it('adds messages to local state without persisting transcript writes from the frontend', async () => {
    const storage = {
      createManagedSession: vi.fn(async () => ({
        sessionId: 'backend-session-id',
        sessionKey: 'backend-session-id',
        agentName: 'Agent',
        llmSlug: 'openrouter/model-1',
        startedAt: '2026-04-06T12:00:00.000Z',
        updatedAt: '2026-04-06T12:00:00.000Z',
        sessionFile: 'sessions/backend-session-id.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      })),
      appendEntry: vi.fn(async () => {}),
      replaceEntries: vi.fn(async () => {}),
      updateSessionMeta: vi.fn(async () => {}),
      deleteSession: vi.fn(async () => {}),
      listSessions: vi.fn(async () => []),
      readEntries: vi.fn(async () => []),
    } as any;

    const store = useSessionStore.getState();
    store.bindStorage(storage as any);
    const sessionId = await store.createSession('Agent', 'openrouter', 'model-1');
    const message: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    await store.addMessage(sessionId, message);

    expect(useSessionStore.getState().sessions[sessionId]?.messages).toEqual([message]);
    expect(storage.appendEntry).not.toHaveBeenCalled();
    expect(storage.replaceEntries).not.toHaveBeenCalled();
    expect(storage.updateSessionMeta).not.toHaveBeenCalled();
  });

  it('loads backend-managed transcript entries from storage files', async () => {
    const config = makeTempConfig();
    tempStoragePath = config.storagePath;

    const storage = new StorageEngine(config, 'Agent');
    await storage.init();
    const meta = await storage.createManagedSession('openrouter/model-1');
    await storage.appendEntry(meta.sessionId, {
      type: 'message',
      id: 'assistant-1',
      parentId: null,
      timestamp: '2026-04-06T12:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Final reply' }],
        timestamp: Date.parse('2026-04-06T12:00:01.000Z'),
      },
    });

    const store = useSessionStore.getState();
    store.bindStorage(storage as any);
    await store.loadSessionsFromDisk();

    expect(useSessionStore.getState().sessions[meta.sessionId]?.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Final reply',
      }),
    ]);
  });
});
