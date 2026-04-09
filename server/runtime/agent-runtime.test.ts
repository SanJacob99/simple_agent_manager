import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from './agent-runtime';
import type { AgentConfig } from '../../shared/agent-config';

vi.mock('../logger');

const promptMock = vi.fn();
const subscribeMock = vi.fn(() => vi.fn());
const abortMock = vi.fn();

vi.mock('@mariozechner/pi-agent-core', () => {
  class MockAgent {
    state = {
      systemPrompt: 'Test prompt',
      model: { id: 'gpt-4' },
      messages: [],
    };

    prompt = promptMock;
    subscribe = subscribeMock;
    abort = abortMock;
  }

  return { Agent: MockAgent };
});

vi.mock('./model-resolver', () => ({
  resolveRuntimeModel: vi.fn(() => ({ id: 'gpt-4' })),
}));

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
      sections: [{ key: 'manual', label: 'Manual Prompt', content: 'Test prompt', tokenEstimate: 2 }],
      assembled: 'Test prompt',
      userInstructions: 'Test prompt',
    },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: null,
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    runTimeoutMs: 172800000,
    ...overrides,
  };
}

describe('AgentRuntime', () => {
  beforeEach(() => {
    promptMock.mockReset();
    subscribeMock.mockClear();
    abortMock.mockClear();
  });

  it('rejects prompt when the underlying agent prompt throws', async () => {
    promptMock.mockRejectedValueOnce(new Error('stream failed'));

    const runtime = new AgentRuntime(makeConfig(), () => 'sk-test');

    await expect(runtime.prompt('Hello')).rejects.toThrow('stream failed');
  });
});
