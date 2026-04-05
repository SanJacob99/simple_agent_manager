import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunCoordinator } from './run-coordinator';
import type { AgentConfig } from '../../shared/agent-config';
import type { AgentRuntime } from '../runtime/agent-runtime';
import type { StorageEngine } from '../runtime/storage-engine';
import type { SessionMeta } from '../../shared/storage-types';

function mockRuntime(): AgentRuntime {
  return {
    prompt: vi.fn(() => Promise.resolve()),
    abort: vi.fn(),
    destroy: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    state: { messages: [] },
  } as any;
}

function mockStorage(): StorageEngine {
  const sessions: SessionMeta[] = [];
  return {
    getSessionByKey: vi.fn(async (key: string) => {
      return sessions.find((s) => s.sessionKey === key) ?? null;
    }),
    createSession: vi.fn(async (meta: SessionMeta) => {
      sessions.push(meta);
    }),
    updateSessionMeta: vi.fn(),
    enforceRetention: vi.fn(),
    listSessions: vi.fn(async () => sessions),
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
    systemPrompt: {
      mode: 'manual',
      sections: [{ key: 'manual', label: 'Manual Prompt', content: 'Test', tokenEstimate: 1 }],
      assembled: 'Test',
      userInstructions: 'Test',
    },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: {
      label: 'Storage',
      backendType: 'filesystem',
      storagePath: '/tmp/test',
      sessionRetention: 50,
      memoryEnabled: false,
      dailyMemoryEnabled: false,
    },
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    runTimeoutMs: 172800000,
    ...overrides,
  };
}

describe('RunCoordinator', () => {
  let runtime: AgentRuntime;
  let storage: StorageEngine;
  let coordinator: RunCoordinator;

  beforeEach(() => {
    runtime = mockRuntime();
    storage = mockStorage();
    coordinator = new RunCoordinator('agent-1', runtime, makeConfig(), storage);
  });

  afterEach(() => {
    coordinator.destroy();
  });

  describe('dispatch', () => {
    it('returns a runId, sessionId, and acceptedAt', async () => {
      const result = await coordinator.dispatch({ sessionKey: 'test-session', text: 'Hello' });

      expect(result.runId).toBeDefined();
      expect(typeof result.runId).toBe('string');
      expect(result.runId.length).toBeGreaterThan(0);
      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.acceptedAt).toBeDefined();
      expect(typeof result.acceptedAt).toBe('number');
    });

    it('creates a new session when sessionKey is not found', async () => {
      await coordinator.dispatch({ sessionKey: 'new-session', text: 'Hello' });

      expect(storage.getSessionByKey).toHaveBeenCalledWith('new-session');
      expect(storage.createSession).toHaveBeenCalledTimes(1);
      const createdMeta = (storage.createSession as any).mock.calls[0][0] as SessionMeta;
      expect(createdMeta.sessionKey).toBe('new-session');
      expect(createdMeta.sessionId).toBeDefined();
    });

    it('reuses existing session when sessionKey is found', async () => {
      // First dispatch creates the session
      const firstResult = await coordinator.dispatch({ sessionKey: 'reuse-session', text: 'First' });
      // Wait for the first run to complete
      await coordinator.wait(firstResult.runId, 5000);

      // Second dispatch reuses
      await coordinator.dispatch({ sessionKey: 'reuse-session', text: 'Second' });

      // createSession called only once (from the first dispatch)
      expect(storage.createSession).toHaveBeenCalledTimes(1);
    });

    it('enforces retention after creating a new session', async () => {
      await coordinator.dispatch({ sessionKey: 'retention-test', text: 'Hello' });

      expect(storage.enforceRetention).toHaveBeenCalledWith(50);
    });

    it('rejects dispatch when a run is already active on the same session', async () => {
      // Make runtime.prompt hang to keep the run active
      (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

      await coordinator.dispatch({ sessionKey: 'busy-session', text: 'First' });

      await expect(
        coordinator.dispatch({ sessionKey: 'busy-session', text: 'Second' })
      ).rejects.toThrow(/already active/i);
    });
  });
});
