import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { RunCoordinator } from './run-coordinator';
import { StreamProcessor } from './stream-processor';
import { StorageEngine } from '../runtime/storage-engine';
import type { AgentRuntime } from '../runtime/agent-runtime';
import type { AgentConfig } from '../../shared/agent-config';
import { HookRegistry } from '../hooks/hook-registry';
import { HOOK_NAMES, type BeforeAgentReplyContext } from '../hooks/hook-types';

const RUN_DIAGNOSTIC_CUSTOM_TYPE = 'sam.run_diagnostic';

function makeUsage() {
  return {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function mockRuntime(): AgentRuntime {
  const listeners = new Set<(event: any) => void>();
  const runtime: any = {
    prompt: vi.fn(() => Promise.resolve()),
    abort: vi.fn(),
    destroy: vi.fn(),
    subscribe: vi.fn((listener: (event: any) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    setModel: vi.fn(),
    setSystemPrompt: vi.fn(),
    getSystemPrompt: vi.fn(() => 'Test'),
    setActiveSession: vi.fn(),
    clearActiveSession: vi.fn(),
    setSessionContext: vi.fn((messages: any[]) => {
      runtime.state.messages = [...messages];
    }),
    addTools: vi.fn(),
    state: {
      messages: [],
      model: { api: 'openai-completions' },
    },
    emitEvent: (event: any) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
  return runtime as AgentRuntime;
}

function makeConfig(storagePath: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
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
      storagePath,
      sessionRetention: 50,
      memoryEnabled: false,
      dailyMemoryEnabled: false,
      dailyResetEnabled: true,
      dailyResetHour: 4,
      idleResetEnabled: false,
      idleResetMinutes: 60,
      parentForkMaxTokens: 100000,
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
  let storagePath: string;
  let config: AgentConfig;
  let storage: StorageEngine;
  let coordinator: RunCoordinator;

  beforeEach(async () => {
    storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-run-coordinator-'));
    config = makeConfig(storagePath);
    runtime = mockRuntime();
    storage = new StorageEngine(config.storage!, config.name);
    await storage.init();
    coordinator = new RunCoordinator('agent-1', runtime, config, storage);
  });

  afterEach(async () => {
    coordinator.destroy();
    await fs.rm(storagePath, { recursive: true, force: true });
  });

  async function getSession(subKey: string) {
    return storage.getSession(`agent:agent-1:${subKey}`);
  }

  async function readTranscript(subKey: string) {
    const session = await getSession(subKey);
    expect(session).toBeTruthy();
    const transcriptPath = storage.resolveTranscriptPath(session!);
    return SessionManager.open(transcriptPath, storage.getSessionsDir(), process.cwd()).getEntries();
  }

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

    it('creates a new session when the subKey is first routed', async () => {
      const retentionSpy = vi.spyOn(storage, 'enforceRetention');

      await coordinator.dispatch({ sessionKey: 'new-session', text: 'Hello' });

      const session = await getSession('new-session');
      expect(session?.sessionKey).toBe('agent:agent-1:new-session');
      expect(retentionSpy).toHaveBeenCalledWith(50);
    });

    it('reuses an existing session when the same subKey is routed again', async () => {
      const first = await coordinator.dispatch({ sessionKey: 'reuse-session', text: 'First' });
      await coordinator.wait(first.runId, 5000);

      const second = await coordinator.dispatch({ sessionKey: 'reuse-session', text: 'Second' });
      await coordinator.wait(second.runId, 5000);

      expect(second.sessionId).toBe(first.sessionId);
    });

    it('reuses an existing session when the frontend passes the backend session id', async () => {
      const first = await coordinator.dispatch({ sessionKey: 'backend-managed', text: 'First' });
      await coordinator.wait(first.runId, 5000);

      const second = await coordinator.dispatch({ sessionKey: first.sessionId, text: 'Second' });
      await coordinator.wait(second.runId, 5000);

      expect(second.sessionId).toBe(first.sessionId);
    });

    it('persists the user message from the backend when a run starts', async () => {
      const result = await coordinator.dispatch({ sessionKey: 'persist-user', text: 'Hello backend' });
      await coordinator.wait(result.runId, 5000);

      const entries = await readTranscript('persist-user');
      expect(entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'message',
            message: expect.objectContaining({
              role: 'user',
              content: 'Hello backend',
            }),
          }),
        ]),
      );
    });

    it('does not inject session tools when no tools are resolved for the agent', async () => {
      const result = await coordinator.dispatch({ sessionKey: 'no-session-tools', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      expect(runtime.addTools).not.toHaveBeenCalled();
    });

    it('injects only the resolved session tools for the agent', async () => {
      coordinator.destroy();
      config = makeConfig(storagePath, {
        tools: {
          profile: 'custom',
          resolvedTools: ['sessions_list'],
          enabledGroups: [],
          skills: [],
          plugins: [],
          subAgentSpawning: false,
          maxSubAgents: 3,
        },
      });
      runtime = mockRuntime();
      coordinator = new RunCoordinator('agent-1', runtime, config, storage);

      const result = await coordinator.dispatch({ sessionKey: 'selected-session-tools', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      expect(runtime.addTools).toHaveBeenCalledTimes(1);
      const [tools] = (runtime.addTools as any).mock.calls[0];
      expect(tools.map((tool: any) => tool.name)).toEqual(['sessions_list']);
    });

    it('persists tool and assistant transcript entries and updates usage counters', async () => {
      (runtime.prompt as any).mockImplementationOnce(async () => {
        (runtime as any).emitEvent({
          type: 'tool_execution_end',
          toolCallId: 'tool-1',
          toolName: 'search',
          result: {
            content: [{ type: 'text', text: 'found 3 results' }],
          },
          isError: false,
        });
        (runtime as any).emitEvent({
          type: 'message_start',
          message: { role: 'assistant' },
        });
        (runtime as any).emitEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_delta',
            contentIndex: 0,
            delta: 'Final',
          },
        });
        (runtime as any).emitEvent({
          type: 'message_update',
          assistantMessageEvent: {
            type: 'text_end',
            contentIndex: 0,
            content: 'Final reply',
          },
        });
        (runtime as any).emitEvent({
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: 'Final reply' }],
            api: 'openai-completions',
            provider: 'openai',
            model: 'gpt-4',
            usage: makeUsage(),
            stopReason: 'stop',
            timestamp: Date.now(),
          },
        });
      });

      const result = await coordinator.dispatch({ sessionKey: 'persist-stream', text: 'Hello' });
      await coordinator.wait(result.runId, 5000);

      const entries = await readTranscript('persist-stream');
      const roles = entries
        .filter((entry) => entry.type === 'message')
        .map((entry) => (entry as any).message.role);

      expect(roles).toEqual(['user', 'toolResult', 'assistant']);

      const status = await getSession('persist-stream');
      expect(status?.inputTokens).toBe(10);
      expect(status?.outputTokens).toBe(5);
      expect(status?.totalTokens).toBe(15);
    });

    it('persists a durable diagnostic when the run fails before an assistant reply', async () => {
      (runtime.prompt as any).mockRejectedValueOnce(new Error('Model failed'));

      const result = await coordinator.dispatch({ sessionKey: 'user-only', text: 'Hello' });
      const wait = await coordinator.wait(result.runId, 5000);

      expect(wait.status).toBe('error');

      const entries = await readTranscript('user-only');
      expect(entries).toHaveLength(2);
      expect((entries[0] as any).message.role).toBe('user');
      expect(entries[1]).toEqual(
        expect.objectContaining({
          type: 'custom',
          customType: RUN_DIAGNOSTIC_CUSTOM_TYPE,
          data: expect.objectContaining({
            kind: 'run_error',
            runId: result.runId,
            sessionId: result.sessionId,
            code: 'internal',
            message: 'Model failed',
            phase: 'running',
            retriable: false,
          }),
        }),
      );
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
      await new Promise((r) => setTimeout(r, 10));

      const startEvent = events.find((e) => e.type === 'lifecycle:start');
      expect(startEvent).toBeDefined();
      expect(startEvent.agentId).toBe('agent-1');
      expect(startEvent.runId).toBeDefined();
      expect(startEvent.sessionId).toBeDefined();
      expect(startEvent.startedAt).toBeDefined();
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
  });

  describe('abort', () => {
    it('aborts an active run and emits lifecycle:error', async () => {
      (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

      const { runId } = await coordinator.dispatch({ sessionKey: 'abort-test', text: 'Hello' });
      await new Promise((r) => setTimeout(r, 10));

      coordinator.abort(runId);

      const result = await coordinator.wait(runId, 1000);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('aborted');
      expect(runtime.abort).toHaveBeenCalled();
    });
  });

  describe('integration: stream processor', () => {
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
        config,
        storage,
        hooks,
      );
      const processor = new StreamProcessor('agent-1', hookedCoordinator, config);
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
      } finally {
        processor.destroy();
        hookedCoordinator.destroy();
        hooks.destroy();
      }
    });
  });
});
