import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from './graph-store';
import { useSettingsStore } from '../settings/settings-store';
import { useAgentConnectionStore } from './agent-connection-store';

const storageClientMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  init: vi.fn(async () => undefined),
  deleteAllSessions: vi.fn(async () => undefined),
}));

const resolveAgentConfigMock = vi.hoisted(() => vi.fn());

vi.mock('../runtime/storage-client', () => ({
  StorageClient: class MockStorageClient {
    agentId: string;

    constructor(config: unknown, agentName: string, agentId: string) {
      storageClientMocks.construct(config, agentName, agentId);
      this.agentId = agentId;
    }

    init = storageClientMocks.init;
    deleteAllSessions = storageClientMocks.deleteAllSessions;
  },
}));

vi.mock('../utils/graph-to-agent', () => ({
  resolveAgentConfig: resolveAgentConfigMock,
}));

describe('graph store defaults integration', () => {
  beforeEach(() => {
    resolveAgentConfigMock.mockReset();
    resolveAgentConfigMock.mockReturnValue({ storage: { baseDir: 'sessions' } });
    storageClientMocks.construct.mockClear();
    storageClientMocks.init.mockClear();
    storageClientMocks.deleteAllSessions.mockClear();

    localStorage.clear();
    useGraphStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      pendingNameNodeId: null,
    } as any);
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: {
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
        systemPromptMode: 'auto',
        systemPrompt: 'Be concise.',
        safetyGuardrails: 'Test guardrails.',
      },
      providerDefaults: {
        pluginId: 'openrouter',
        authMethodId: 'api-key',
        envVar: 'OPENROUTER_API_KEY',
        baseUrl: '',
      },
    });
    useAgentConnectionStore.setState({
      chatAgentNodeId: 'agent-1',
      agents: {},
    } as any);
  });

  it('applies settings defaults when creating a new agent node', () => {
    const id = useGraphStore.getState().addNode('agent', { x: 10, y: 20 });
    const node = useGraphStore.getState().nodes.find((entry) => entry.id === id);

    expect(node?.data.type).toBe('agent');
    if (node?.data.type === 'agent') {
      expect(node.data.modelId).toBe('gpt-4o');
      expect(node.data.thinkingLevel).toBe('high');
      expect(node.data.systemPrompt).toBe('Be concise.');
    }
  });

  it('applies provider defaults when creating a new provider node', () => {
    const id = useGraphStore.getState().addNode('provider', { x: 10, y: 20 });
    const node = useGraphStore.getState().nodes.find((entry) => entry.id === id);

    expect(node?.data.type).toBe('provider');
    if (node?.data.type === 'provider') {
      expect(node.data.pluginId).toBe('openrouter');
      expect(node.data.authMethodId).toBe('api-key');
      expect(node.data.envVar).toBe('OPENROUTER_API_KEY');
    }
  });

  it('does not apply agent defaults to non-agent nodes', () => {
    const id = useGraphStore.getState().addNode('tools', { x: 0, y: 0 });
    const node = useGraphStore.getState().nodes.find((entry) => entry.id === id);

    expect(node?.data.type).toBe('tools');
    if (node?.data.type === 'tools') {
      expect(node.data.profile).toBe('full');
    }
  });

  it('applies only the three approved fields to existing agents without overwriting systemPrompt', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            systemPrompt: 'Old prompt',
            description: 'keep me',
            tags: ['keep'],
            modelCapabilities: { contextWindow: 5000 },
          },
        },
      ],
    } as any);

    useGraphStore.getState().applyAgentDefaultsToExistingAgents();

    const node = useGraphStore.getState().nodes[0];
    expect(node.data.type).toBe('agent');
    if (node.data.type === 'agent') {
      expect(node.data.modelId).toBe('gpt-4o');
      expect(node.data.thinkingLevel).toBe('high');
      expect(node.data.systemPrompt).toBe('Old prompt');
      expect(node.data.description).toBe('keep me');
      expect(node.data.tags).toEqual(['keep']);
      expect(node.data.modelCapabilities).toEqual({ contextWindow: 5000 });
    }
  });

  it('clears graph state without touching settings defaults', () => {
    useGraphStore.setState({
      nodes: [{ id: 'x', type: 'agent' }] as any,
      edges: [{ id: 'e', source: 'x', target: 'y' }] as any,
      selectedNodeId: 'x',
      pendingNameNodeId: 'x',
    });

    useGraphStore.getState().clearGraph();

    expect(useGraphStore.getState().nodes).toEqual([]);
    expect(useGraphStore.getState().edges).toEqual([]);
    expect(useGraphStore.getState().selectedNodeId).toBeNull();
    expect(useSettingsStore.getState().providerDefaults.pluginId).toBe('openrouter');
  });

  it('closes the chat drawer when selecting a node', () => {
    useGraphStore.getState().setSelectedNode('agent-2');

    expect(useGraphStore.getState().selectedNodeId).toBe('agent-2');
    expect(useAgentConnectionStore.getState().chatAgentNodeId).toBeNull();
  });

  it('deletes persisted sessions when removing an agent with deleteData enabled', async () => {
    useGraphStore.setState({
      nodes: [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Alpha',
            nameConfirmed: true,
          },
        },
      ],
      edges: [],
      selectedNodeId: 'agent-1',
      pendingDeleteAgent: { nodeId: 'agent-1', agentName: 'Alpha' },
    } as any);

    useGraphStore.getState().confirmDeleteAgent(true);

    expect(useGraphStore.getState().nodes).toEqual([]);
    expect(useGraphStore.getState().selectedNodeId).toBeNull();

    await Promise.resolve();
    await Promise.resolve();

    expect(storageClientMocks.construct).toHaveBeenCalledWith(
      { baseDir: 'sessions' },
      'Alpha',
      'agent-1',
    );
    expect(storageClientMocks.init).toHaveBeenCalledOnce();
    expect(storageClientMocks.deleteAllSessions).toHaveBeenCalledOnce();
  });
});
