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

  describe('lifecycle events', () => {
    it('emits lifecycle:start on dispatch', async () => {
      const events: any[] = [];
      coordinator.subscribeAll((event) => events.push(event));

      await coordinator.dispatch({ sessionKey: 'lifecycle-test', text: 'Hello' });

      // Allow the async execution to start
      await new Promise((r) => setTimeout(r, 10));

      const startEvent = events.find((e) => e.type === 'lifecycle:start');
      expect(startEvent).toBeDefined();
      expect(startEvent.agentId).toBe('agent-1');
      expect(startEvent.runId).toBeDefined();
      expect(startEvent.sessionId).toBeDefined();
      expect(startEvent.startedAt).toBeDefined();
    });

    it('emits lifecycle:end on successful completion', async () => {
      const events: any[] = [];
      coordinator.subscribeAll((event) => events.push(event));

      const { runId } = await coordinator.dispatch({ sessionKey: 'success-test', text: 'Hello' });
      await coordinator.wait(runId, 5000);

      const endEvent = events.find((e) => e.type === 'lifecycle:end');
      expect(endEvent).toBeDefined();
      expect(endEvent.status).toBe('ok');
      expect(endEvent.runId).toBe(runId);
      expect(endEvent.startedAt).toBeDefined();
      expect(endEvent.endedAt).toBeDefined();
      expect(endEvent.endedAt).toBeGreaterThanOrEqual(endEvent.startedAt);
    });

    it('emits lifecycle:error when runtime.prompt rejects', async () => {
      (runtime.prompt as any).mockRejectedValueOnce(new Error('Model failed'));

      const events: any[] = [];
      coordinator.subscribeAll((event) => events.push(event));

      const { runId } = await coordinator.dispatch({ sessionKey: 'error-test', text: 'Hello' });
      const result = await coordinator.wait(runId, 5000);

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('internal');
      expect(result.error?.message).toBe('Model failed');

      const errorEvent = events.find((e) => e.type === 'lifecycle:error');
      expect(errorEvent).toBeDefined();
      expect(errorEvent.error.code).toBe('internal');
    });
  });

  describe('wait', () => {
    it('resolves immediately if run is already completed', async () => {
      const { runId } = await coordinator.dispatch({ sessionKey: 'wait-done', text: 'Hello' });
      await coordinator.wait(runId, 5000);

      const result = await coordinator.wait(runId, 100);
      expect(result.status).toBe('ok');
    });

    it('returns timeout status when wait exceeds timeout', async () => {
      (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

      const { runId } = await coordinator.dispatch({ sessionKey: 'wait-timeout', text: 'Hello' });
      const result = await coordinator.wait(runId, 50);

      expect(result.status).toBe('timeout');
      expect(result.runId).toBe(runId);
    });

    it('returns error for unknown runId', async () => {
      const result = await coordinator.wait('nonexistent-run', 100);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('internal');
    });
  });

  describe('timeout', () => {
    it('aborts the run when run timeout expires', async () => {
      (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

      const events: any[] = [];
      coordinator.subscribeAll((event) => events.push(event));

      const { runId } = await coordinator.dispatch({
        sessionKey: 'timeout-test',
        text: 'Hello',
        timeoutMs: 50,
      });

      const result = await coordinator.wait(runId, 5000);

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('timeout');
      expect(runtime.abort).toHaveBeenCalled();
    });
  });

  describe('abort', () => {
    it('aborts an active run and emits lifecycle:error', async () => {
      (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

      const events: any[] = [];
      coordinator.subscribeAll((event) => events.push(event));

      const { runId } = await coordinator.dispatch({ sessionKey: 'abort-test', text: 'Hello' });

      await new Promise((r) => setTimeout(r, 10));

      coordinator.abort(runId);

      const result = await coordinator.wait(runId, 1000);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('aborted');
      expect(runtime.abort).toHaveBeenCalled();
    });

    it('does nothing for completed runs', async () => {
      const { runId } = await coordinator.dispatch({ sessionKey: 'abort-done', text: 'Hello' });
      await coordinator.wait(runId, 5000);

      coordinator.abort(runId);
      const record = coordinator.getRunStatus(runId);
      expect(record?.status).toBe('completed');
    });
  });

  describe('subscribe', () => {
    it('delivers stream events only for the subscribed run', async () => {
      const events: any[] = [];

      const { runId } = await coordinator.dispatch({ sessionKey: 'sub-test', text: 'Hello' });
      coordinator.subscribe(runId, (event) => events.push(event));

      await coordinator.wait(runId, 5000);

      const streamEvents = events.filter((e) => e.type === 'stream');
      for (const e of streamEvents) {
        expect(e.runId).toBe(runId);
      }
    });
  });

  describe('integration: full dispatch-wait cycle', () => {
    it('dispatches, streams events, waits, and returns payloads', async () => {
      const allEvents: any[] = [];
      coordinator.subscribeAll((event) => allEvents.push(event));

      const { runId } = await coordinator.dispatch({ sessionKey: 'full-cycle', text: 'Hello' });
      const result = await coordinator.wait(runId, 5000);

      expect(result.status).toBe('ok');
      expect(result.runId).toBe(runId);

      const lifecycleStart = allEvents.find((e) => e.type === 'lifecycle:start');
      expect(lifecycleStart).toBeDefined();
      expect(lifecycleStart.runId).toBe(runId);

      const lifecycleEnd = allEvents.find((e) => e.type === 'lifecycle:end');
      expect(lifecycleEnd).toBeDefined();
      expect(lifecycleEnd.runId).toBe(runId);
      expect(lifecycleEnd.status).toBe('ok');
    });

    it('session is reusable after a run completes', async () => {
      const { runId: run1 } = await coordinator.dispatch({ sessionKey: 'reuse', text: 'First' });
      await coordinator.wait(run1, 5000);

      const { runId: run2 } = await coordinator.dispatch({ sessionKey: 'reuse', text: 'Second' });
      await coordinator.wait(run2, 5000);

      expect(run1).not.toBe(run2);

      const result = await coordinator.wait(run2, 100);
      expect(result.status).toBe('ok');
    });

    it('classifyError maps rate limit errors correctly', async () => {
      (runtime.prompt as any).mockRejectedValueOnce(new Error('Rate limit exceeded (429)'));

      const { runId } = await coordinator.dispatch({ sessionKey: 'rate-limit', text: 'Hello' });
      const result = await coordinator.wait(runId, 5000);

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('rate_limited');
      expect(result.error?.retriable).toBe(true);
    });
  });
});
