import { beforeEach, describe, expect, it } from 'vitest';
import { useGraphStore } from './graph-store';
import { useSettingsStore } from '../settings/settings-store';

describe('graph store defaults integration', () => {
  beforeEach(() => {
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
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
        systemPrompt: 'Be concise.',
      },
    });
  });

  it('applies settings defaults when creating a new agent node', () => {
    const id = useGraphStore.getState().addNode('agent', { x: 10, y: 20 });
    const node = useGraphStore.getState().nodes.find((entry) => entry.id === id);

    expect(node?.data.type).toBe('agent');
    if (node?.data.type === 'agent') {
      expect(node.data.provider).toBe('openai');
      expect(node.data.modelId).toBe('gpt-4o');
      expect(node.data.thinkingLevel).toBe('high');
      expect(node.data.systemPrompt).toBe('Be concise.');
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

  it('applies only the four approved fields to existing agents', () => {
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
            provider: 'anthropic',
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
      expect(node.data.provider).toBe('openai');
      expect(node.data.modelId).toBe('gpt-4o');
      expect(node.data.thinkingLevel).toBe('high');
      expect(node.data.systemPrompt).toBe('Be concise.');
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
    expect(useSettingsStore.getState().agentDefaults.provider).toBe('openai');
  });
});
