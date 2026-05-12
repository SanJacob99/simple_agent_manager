import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCoordinationStore } from './coordination-store';
import type { AgentConfig } from '../../shared/agent-config';

function makeConfig(): AgentConfig {
  return {
    id: 'manager',
    version: 2,
    name: 'Manager',
    description: '',
    tags: [],
    provider: { pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' },
    modelId: 'openai/gpt-4o',
    thinkingLevel: 'off',
    systemPrompt: { mode: 'append', sections: [], assembled: '', userInstructions: '' },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    agentComm: [],
    storage: null,
    vectorDatabases: [],
    crons: [],
    mcps: [],
    subAgents: [],
    coordination: { role: 'manager', capabilities: [], maxConcurrentTasks: 1 },
    workspacePath: null,
    exportedAt: Date.now(),
    sourceGraphId: 'test',
    runTimeoutMs: 60000,
  };
}

describe('coordination-store', () => {
  beforeEach(() => {
    useCoordinationStore.setState({
      agents: [],
      workflows: [],
      traces: {},
      loading: false,
      error: null,
    });
    vi.restoreAllMocks();
  });

  it('syncs resolved agent configs to the coordination API', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [{
          agentId: 'manager',
          name: 'Manager',
          role: 'manager',
          capabilities: [],
          maxConcurrentTasks: 1,
          available: false,
          unavailableReasons: ['missing_storage'],
          configHash: 'hash',
          updatedAt: '2026-05-12T00:00:00.000Z',
        }],
      }),
    } as Response);

    await useCoordinationStore.getState().syncAgents([makeConfig()]);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/coordination/agents/sync',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(useCoordinationStore.getState().agents[0].role).toBe('manager');
  });
});

