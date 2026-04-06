import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RunCoordinator } from './run-coordinator';
import { StreamProcessor } from './stream-processor';
import type { AgentConfig } from '../../shared/agent-config';
import type { AgentRuntime } from '../runtime/agent-runtime';
import type { StorageEngine } from '../runtime/storage-engine';
import type { SessionMeta } from '../../shared/storage-types';
import { HookRegistry } from '../hooks/hook-registry';
import { HOOK_NAMES, type BeforeAgentReplyContext } from '../hooks/hook-types';

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

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

    it('accepts a second dispatch on the same session and leaves it pending', async () => {
      const deferred = createDeferred<void>();
      (runtime.prompt as any).mockImplementationOnce(() => deferred.promise);

      const first = await coordinator.dispatch({ sessionKey: 'same', text: 'First' });
      const second = await coordinator.dispatch({ sessionKey: 'same', text: 'Second' });

      const secondRecord = coordinator.getRunStatus(second.runId)! as any;
      expect(secondRecord.status).toBe('pending');
      expect(secondRecord.queue).toEqual({ sessionPosition: 1, globalPosition: 1 });

      deferred.resolve();
      await coordinator.wait(first.runId, 5000);
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

    it('returns phase pending when wait times out before a queued run starts', async () => {
      const deferred = createDeferred<void>();
      (runtime.prompt as any).mockImplementationOnce(() => deferred.promise);

      await coordinator.dispatch({ sessionKey: 'same', text: 'First' });
      const second = await coordinator.dispatch({ sessionKey: 'same', text: 'Second' });

      const result = await coordinator.wait(second.runId, 25);

      expect(result.status).toBe('timeout');
      expect((result as any).phase).toBe('pending');
      expect((result as any).queue).toEqual({ sessionPosition: 1, globalPosition: 1 });

      deferred.resolve();
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

    it('aborts a pending run without calling runtime.abort', async () => {
      const deferred = createDeferred<void>();
      (runtime.prompt as any).mockImplementationOnce(() => deferred.promise);

      const events: any[] = [];
      coordinator.subscribeAll((event) => events.push(event));

      await coordinator.dispatch({ sessionKey: 'same', text: 'First' });
      const second = await coordinator.dispatch({ sessionKey: 'same', text: 'Second' });

      coordinator.abort(second.runId);

      const result = await coordinator.wait(second.runId, 1000);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('aborted');
      expect(runtime.abort).toHaveBeenCalledTimes(0);
      expect(events.some((e) => e.type === 'queue:left' && e.reason === 'aborted')).toBe(true);

      deferred.resolve();
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

    it('starts the next eligible queued run when the active run finishes', async () => {
      const first = createDeferred<void>();
      const second = createDeferred<void>();

      (runtime.prompt as any)
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);

      const run1 = await coordinator.dispatch({ sessionKey: 'sess-a', text: 'First' });
      const run2 = await coordinator.dispatch({ sessionKey: 'sess-b', text: 'Second' });

      expect(coordinator.getRunStatus(run2.runId)?.status).toBe('pending');

      first.resolve();
      await coordinator.wait(run1.runId, 5000);

      expect(coordinator.getRunStatus(run2.runId)?.status).toBe('running');

      second.resolve();
      await coordinator.wait(run2.runId, 5000);
    });

    it('streams a synthetic reply when before_agent_reply claims the turn', async () => {
      const hooks = new HookRegistry();
      hooks.register<BeforeAgentReplyContext>(HOOK_NAMES.BEFORE_AGENT_REPLY, {
        pluginId: 'test-plugin',
        priority: 100,
        critical: false,
        handler: (ctx) => {
          ctx.claimed = true;
          ctx.syntheticReply = 'Synthetic hello';
        },
      });

      const hookedCoordinator = new RunCoordinator(
        'agent-1',
        runtime,
        makeConfig(),
        storage,
        hooks,
      );
      const processor = new StreamProcessor('agent-1', hookedCoordinator, makeConfig());
      const emitted: any[] = [];
      processor.subscribe((event) => emitted.push(event));

      try {
        const { runId } = await hookedCoordinator.dispatch({
          sessionKey: 'hook-claim',
          text: 'Hello',
        });
        const result = await hookedCoordinator.wait(runId, 5000);

        expect(result.status).toBe('ok');
        expect(result.payloads).toEqual([{ type: 'text', content: 'Synthetic hello' }]);
        expect(runtime.prompt).not.toHaveBeenCalled();
        expect(emitted.map((event) => event.type)).toEqual(
          expect.arrayContaining(['message:start', 'message:delta', 'message:end', 'lifecycle:end']),
        );

        const lifecycleEnd = emitted.find((event) => event.type === 'lifecycle:end');
        expect(lifecycleEnd?.payloads).toEqual([{ type: 'text', content: 'Synthetic hello' }]);
      } finally {
        processor.destroy();
        hookedCoordinator.destroy();
        hooks.destroy();
      }
    });
  });
});
