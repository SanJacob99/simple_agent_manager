import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentManager } from './agent-manager';
import { ApiKeyStore } from '../auth/api-keys';
import type { AgentConfig } from '../../shared/agent-config';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

// Mock AgentRuntime to avoid pi-agent-core model resolution
vi.mock('../runtime/agent-runtime', () => {
  class MockAgentRuntime {
    subscribe = vi.fn(() => vi.fn());
    prompt = vi.fn(() => Promise.resolve());
    abort = vi.fn();
    destroy = vi.fn();
    setModel = vi.fn();
    setSystemPrompt = vi.fn();
    getSystemPrompt = vi.fn(() => 'Test prompt');
    setActiveSession = vi.fn();
    clearActiveSession = vi.fn();
    setSessionContext = vi.fn((messages: any[]) => {
      this.state.messages = [...messages];
    });
    addTools = vi.fn();
    state = { messages: [], model: { api: 'openai-completions' } };
  }
  return { AgentRuntime: MockAgentRuntime };
});

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const storagePath = path.join(
    os.tmpdir(),
    `sam-agent-manager-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
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
      sections: [{ key: 'manual', label: 'Manual Prompt', content: 'You are a test agent.', tokenEstimate: 6 }],
      assembled: 'You are a test agent.',
      userInstructions: 'You are a test agent.',
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

describe('AgentManager', () => {
  let manager: AgentManager;
  let apiKeys: ApiKeyStore;
  const storagePaths = new Set<string>();

  beforeEach(() => {
    apiKeys = new ApiKeyStore();
    apiKeys.setAll({ openai: 'sk-test' });
    manager = new AgentManager(apiKeys);
  });

  afterEach(async () => {
    await manager.shutdown();
    await Promise.all(
      [...storagePaths].map((storagePath) => fs.rm(storagePath, { recursive: true, force: true })),
    );
    storagePaths.clear();
  });

  it('starts an agent and tracks it', async () => {
    const config = makeConfig();
    storagePaths.add(config.storage!.storagePath);
    await manager.start(config);
    expect(manager.has('agent-1')).toBe(true);
  });

  it('destroys an agent', async () => {
    const config = makeConfig();
    storagePaths.add(config.storage!.storagePath);
    await manager.start(config);
    manager.destroy('agent-1');
    expect(manager.has('agent-1')).toBe(false);
  });

  it('replaces an existing agent on re-start', async () => {
    const first = makeConfig();
    const second = makeConfig({
      systemPrompt: {
        mode: 'manual',
        sections: [{ key: 'manual', label: 'Manual Prompt', content: 'Updated prompt', tokenEstimate: 3 }],
        assembled: 'Updated prompt',
        userInstructions: 'Updated prompt',
      },
    });
    storagePaths.add(first.storage!.storagePath);
    storagePaths.add(second.storage!.storagePath);
    await manager.start(first);
    await manager.start(second);
    expect(manager.has('agent-1')).toBe(true);
  });

  it('getStatus returns not_found for unknown agent', () => {
    expect(manager.getStatus('unknown')).toBe('not_found');
  });

  it('shutdown destroys all agents', async () => {
    const first = makeConfig();
    const second = makeConfig({ id: 'agent-2', name: 'Agent 2' });
    storagePaths.add(first.storage!.storagePath);
    storagePaths.add(second.storage!.storagePath);
    await manager.start(first);
    await manager.start(second);
    await manager.shutdown();
    expect(manager.has('agent-1')).toBe(false);
    expect(manager.has('agent-2')).toBe(false);
  });

  describe('dispatch facade', () => {
    it('dispatches a run and returns runId and sessionId', async () => {
      const config = makeConfig();
      storagePaths.add(config.storage!.storagePath);
      await manager.start(config);
      const result = await manager.dispatch('agent-1', {
        sessionKey: 'test-session',
        text: 'Hello',
      });

      expect(result.runId).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.acceptedAt).toBeDefined();
    });

    it('throws for unknown agent', async () => {
      await expect(
        manager.dispatch('unknown', { sessionKey: 's', text: 'Hello' })
      ).rejects.toThrow(/not found/i);
    });

    it('wait returns run result', async () => {
      const config = makeConfig();
      storagePaths.add(config.storage!.storagePath);
      await manager.start(config);
      const { runId } = await manager.dispatch('agent-1', {
        sessionKey: 'wait-test',
        text: 'Hello',
      });

      const result = await manager.wait('agent-1', runId, 5000);
      expect(result.status).toBe('ok');
      expect(result.runId).toBe(runId);
    });

    it('abortRun aborts a specific run', async () => {
      const config = makeConfig();
      storagePaths.add(config.storage!.storagePath);
      await manager.start(config);

      // Make prompt hang
      const runtime = (manager as any).agents.get('agent-1').runtime;
      runtime.prompt.mockImplementation(() => new Promise(() => {}));

      const { runId } = await manager.dispatch('agent-1', {
        sessionKey: 'abort-test',
        text: 'Hello',
      });

      await new Promise((r) => setTimeout(r, 10));
      manager.abortRun('agent-1', runId);

      const result = await manager.wait('agent-1', runId, 5000);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('aborted');
    });

    it('accepts queued dispatches for the same session', async () => {
      const config = makeConfig();
      storagePaths.add(config.storage!.storagePath);
      await manager.start(config);

      const runtime = (manager as any).agents.get('agent-1').runtime;
      const deferred = createDeferred<void>();
      runtime.prompt.mockImplementationOnce(() => deferred.promise);

      const first = await manager.dispatch('agent-1', {
        sessionKey: 'same',
        text: 'First',
      });
      const second = await manager.dispatch('agent-1', {
        sessionKey: 'same',
        text: 'Second',
      });

      expect(first.runId).not.toBe(second.runId);
      expect(manager.getStatus('agent-1')).toBe('running');

      deferred.resolve();
      await manager.wait('agent-1', first.runId, 5000);
    });

    it('aborts a pending run through the facade', async () => {
      const config = makeConfig();
      storagePaths.add(config.storage!.storagePath);
      await manager.start(config);

      const runtime = (manager as any).agents.get('agent-1').runtime;
      const deferred = createDeferred<void>();
      runtime.prompt.mockImplementationOnce(() => deferred.promise);

      await manager.dispatch('agent-1', {
        sessionKey: 'same',
        text: 'First',
      });
      const pending = await manager.dispatch('agent-1', {
        sessionKey: 'same',
        text: 'Second',
      });

      manager.abortRun('agent-1', pending.runId);
      const result = await manager.wait('agent-1', pending.runId, 5000);

      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('aborted');
      expect(runtime.abort).toHaveBeenCalledTimes(0);

      deferred.resolve();
    });
  });
});
