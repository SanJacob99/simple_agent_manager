import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentManager } from './agent-manager';
import { ApiKeyStore } from '../auth/api-keys';
import type { AgentConfig } from '../../shared/agent-config';

// Mock AgentRuntime to avoid pi-agent-core model resolution
vi.mock('../runtime/agent-runtime', () => {
  class MockAgentRuntime {
    subscribe = vi.fn(() => vi.fn());
    prompt = vi.fn(() => Promise.resolve());
    abort = vi.fn();
    destroy = vi.fn();
    state = { messages: [] };
  }
  return { AgentRuntime: MockAgentRuntime };
});

// Mock StorageEngine to avoid filesystem
vi.mock('../runtime/storage-engine', () => {
  class MockStorageEngine {
    private sessions: any[] = [];
    init = vi.fn();
    getSessionByKey = vi.fn(async (key: string) => {
      return this.sessions.find((s: any) => s.sessionKey === key) ?? null;
    });
    createSession = vi.fn(async (meta: any) => {
      this.sessions.push(meta);
    });
    updateSessionMeta = vi.fn();
    enforceRetention = vi.fn();
    listSessions = vi.fn(async () => this.sessions);
  }
  return { StorageEngine: MockStorageEngine };
});

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

describe('AgentManager', () => {
  let manager: AgentManager;
  let apiKeys: ApiKeyStore;

  beforeEach(() => {
    apiKeys = new ApiKeyStore();
    apiKeys.setAll({ openai: 'sk-test' });
    manager = new AgentManager(apiKeys);
  });

  it('starts an agent and tracks it', async () => {
    await manager.start(makeConfig());
    expect(manager.has('agent-1')).toBe(true);
  });

  it('destroys an agent', async () => {
    await manager.start(makeConfig());
    manager.destroy('agent-1');
    expect(manager.has('agent-1')).toBe(false);
  });

  it('replaces an existing agent on re-start', async () => {
    await manager.start(makeConfig());
    await manager.start(makeConfig({
      systemPrompt: {
        mode: 'manual',
        sections: [{ key: 'manual', label: 'Manual Prompt', content: 'Updated prompt', tokenEstimate: 3 }],
        assembled: 'Updated prompt',
        userInstructions: 'Updated prompt',
      },
    }));
    expect(manager.has('agent-1')).toBe(true);
  });

  it('getStatus returns not_found for unknown agent', () => {
    expect(manager.getStatus('unknown')).toBe('not_found');
  });

  it('shutdown destroys all agents', async () => {
    await manager.start(makeConfig());
    await manager.start(makeConfig({ id: 'agent-2', name: 'Agent 2' }));
    await manager.shutdown();
    expect(manager.has('agent-1')).toBe(false);
    expect(manager.has('agent-2')).toBe(false);
  });

  describe('dispatch facade', () => {
    it('dispatches a run and returns runId and sessionId', async () => {
      await manager.start(makeConfig());
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
      await manager.start(makeConfig());
      const { runId } = await manager.dispatch('agent-1', {
        sessionKey: 'wait-test',
        text: 'Hello',
      });

      const result = await manager.wait('agent-1', runId, 5000);
      expect(result.status).toBe('ok');
      expect(result.runId).toBe(runId);
    });

    it('abortRun aborts a specific run', async () => {
      await manager.start(makeConfig());

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
  });
});
