import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentManager } from './agent-manager';
import { ApiKeyStore } from '../auth/api-keys';
import type { AgentConfig } from '../../shared/agent-config';

// Mock AgentRuntime to avoid pi-agent-core model resolution
vi.mock('../runtime/agent-runtime', () => {
  class MockAgentRuntime {
    subscribe = vi.fn(() => vi.fn());
    prompt = vi.fn();
    abort = vi.fn();
    destroy = vi.fn();
    state = { messages: [] };
  }
  return { AgentRuntime: MockAgentRuntime };
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
    storage: null, // null to skip disk persistence in tests
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
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

  it('starts an agent and tracks it', () => {
    manager.start(makeConfig());
    expect(manager.has('agent-1')).toBe(true);
    expect(manager.getStatus('agent-1')).toBe('idle');
  });

  it('destroys an agent', () => {
    manager.start(makeConfig());
    manager.destroy('agent-1');
    expect(manager.has('agent-1')).toBe(false);
  });

  it('replaces an existing agent on re-start', () => {
    manager.start(makeConfig());
    manager.start(makeConfig({
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

  it('abort sets status to idle', () => {
    manager.start(makeConfig());
    manager.abort('agent-1');
    expect(manager.getStatus('agent-1')).toBe('idle');
  });

  it('shutdown destroys all agents', async () => {
    manager.start(makeConfig());
    manager.start(makeConfig({ id: 'agent-2', name: 'Agent 2' }));
    await manager.shutdown();
    expect(manager.has('agent-1')).toBe(false);
    expect(manager.has('agent-2')).toBe(false);
  });
});
