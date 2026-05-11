import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphStore } from './graph-store';
import { useSettingsStore } from '../settings/settings-store';
import { useAgentConnectionStore } from './agent-connection-store';
import type { WorkflowPatch } from '../../shared/sam-agent/workflow-patch';
import { HEX_HEIGHT, HEX_WIDTH } from '../nodes/HexNode';
import { snapToHexCenter } from '../utils/hex-snap';

const storageClientMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  init: vi.fn(async () => undefined),
  deleteAgentData: vi.fn(async () => undefined),
  deleteAllSessions: vi.fn(async () => undefined),
}));

const resolveAgentConfigMock = vi.hoisted(() => vi.fn());
const EPSILON = 1e-6;

function expectAlignedToHoneycomb(position: { x: number; y: number }) {
  const center = {
    x: position.x + HEX_WIDTH / 2,
    y: position.y + HEX_HEIGHT / 2,
  };
  const snappedCenter = snapToHexCenter(center.x, center.y);
  expect(Math.abs(snappedCenter.x - center.x)).toBeLessThan(EPSILON);
  expect(Math.abs(snappedCenter.y - center.y)).toBeLessThan(EPSILON);
}

vi.mock('../runtime/storage-client', () => ({
  StorageClient: class MockStorageClient {
    agentId: string;

    constructor(config: unknown, agentName: string, agentId: string) {
      storageClientMocks.construct(config, agentName, agentId);
      this.agentId = agentId;
    }

    init = storageClientMocks.init;
    deleteAgentData = storageClientMocks.deleteAgentData;
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
    storageClientMocks.deleteAgentData.mockClear();
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

  it('deletes all persisted agent data when removing an agent with deleteData enabled', async () => {
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
    expect(storageClientMocks.deleteAgentData).toHaveBeenCalledOnce();
  });
});

describe('graphStore.applyPatch', () => {
  beforeEach(() => {
    useGraphStore.setState({ nodes: [], edges: [] });
  });

  it('adds nodes and resolves tempIds in edges', () => {
    const patch: WorkflowPatch = {
      add_nodes: [
        { tempId: 'a', type: 'agent', data: { type: 'agent', name: 'A' } as any },
        { tempId: 'p', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' } as any },
      ],
      update_nodes: [], remove_nodes: [],
      add_edges: [{ source: 'p', target: 'a' }],
      remove_edges: [], rationale: 'build',
    };
    const result = useGraphStore.getState().applyPatch(patch);
    expect(result.ok).toBe(true);
    const { nodes, edges } = useGraphStore.getState();
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    const agent = nodes.find((n) => n.data.type === 'agent')!;
    const provider = nodes.find((n) => n.data.type === 'provider')!;
    expect(edges[0].source).toBe(provider.id);
    expect(edges[0].target).toBe(agent.id);
  });

  it('rolls back on error', () => {
    const initial = [{ id: 'existing', type: 'agent', position: { x: 0, y: 0 }, data: { type: 'agent', name: 'X' } as any }];
    useGraphStore.setState({
      nodes: initial,
      edges: [],
    });
    // Force a failure by passing add_nodes that will throw via a Proxy data field accessor.
    const trapData = new Proxy({}, {
      get() { throw new Error('boom'); },
      ownKeys() { throw new Error('boom'); },
    });
    const result = useGraphStore.getState().applyPatch({
      add_nodes: [{ tempId: 't', type: 'agent', data: trapData as any }],
      update_nodes: [], remove_nodes: [], add_edges: [], remove_edges: [], rationale: 'rollback',
    });
    expect(result.ok).toBe(false);
    expect(useGraphStore.getState().nodes).toEqual(initial);
  });

  it('shallow-merges update_nodes dataPatch', () => {
    useGraphStore.setState({
      nodes: [{ id: 'a1', type: 'agent', position: { x: 0, y: 0 }, data: { type: 'agent', name: 'Old', modelId: 'm1' } as any }],
      edges: [],
    });
    useGraphStore.getState().applyPatch({
      add_nodes: [], update_nodes: [{ id: 'a1', dataPatch: { modelId: 'm2' } as any }],
      remove_nodes: [], add_edges: [], remove_edges: [], rationale: 'edit',
    });
    const node = useGraphStore.getState().nodes[0];
    expect((node.data as any).name).toBe('Old');
    expect((node.data as any).modelId).toBe('m2');
  });

  it('removes nodes and incident edges', () => {
    useGraphStore.setState({
      nodes: [
        { id: 'a', type: 'agent', position: { x: 0, y: 0 }, data: { type: 'agent', name: 'A' } as any },
        { id: 'p', type: 'provider', position: { x: 0, y: 0 }, data: { type: 'provider' } as any },
      ],
      edges: [{ id: 'e1', source: 'p', target: 'a', type: 'data' } as any],
    });
    useGraphStore.getState().applyPatch({
      add_nodes: [], update_nodes: [], remove_nodes: ['a'],
      add_edges: [], remove_edges: [], rationale: 'delete',
    });
    expect(useGraphStore.getState().nodes.find((n) => n.id === 'a')).toBeUndefined();
    expect(useGraphStore.getState().edges.find((e) => e.source === 'a' || e.target === 'a')).toBeUndefined();
  });

  it('removes the listed edge ids', () => {
    useGraphStore.setState({
      nodes: [
        { id: 'a', type: 'agent', position: { x: 0, y: 0 }, data: { type: 'agent' } as any },
        { id: 'p', type: 'provider', position: { x: 0, y: 0 }, data: { type: 'provider' } as any },
      ],
      edges: [{ id: 'e1', source: 'p', target: 'a' } as any, { id: 'e2', source: 'p', target: 'a' } as any],
    });
    useGraphStore.getState().applyPatch({
      add_nodes: [], update_nodes: [], remove_nodes: [],
      add_edges: [], remove_edges: ['e1'], rationale: 'edge-cleanup',
    });
    const edges = useGraphStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0].id).toBe('e2');
  });

  it('overrides off-screen positions with a layout near the existing graph', () => {
    useGraphStore.setState({
      nodes: [{ id: 'existing', type: 'agent', position: { x: 300, y: 300 }, data: { type: 'agent' } as any }],
      edges: [],
    });
    useGraphStore.getState().applyPatch({
      add_nodes: [
        { tempId: 'a', type: 'agent', position: { x: -50000, y: -50000 }, data: { type: 'agent' } as any },
      ],
      update_nodes: [], remove_nodes: [], add_edges: [], remove_edges: [], rationale: 'override-coords',
    });
    const newNode = useGraphStore.getState().nodes.find((n) => n.id !== 'existing')!;
    // Far-off model coords should be replaced with a nearby snapped hex cell below the existing graph.
    expect(newNode.position.x).toBeGreaterThan(100);
    expect(newNode.position.x).toBeLessThan(700);
    expect(newNode.position.y).toBeGreaterThan(300);
    expect(newNode.position.y).toBeLessThan(800);
    expectAlignedToHoneycomb(newNode.position);
  });

  it('snaps reasonable positions emitted by the model to the honeycomb', () => {
    useGraphStore.setState({
      nodes: [{ id: 'existing', type: 'agent', position: { x: 300, y: 300 }, data: { type: 'agent' } as any }],
      edges: [],
    });
    useGraphStore.getState().applyPatch({
      add_nodes: [
        { tempId: 'a', type: 'agent', position: { x: 400, y: 350 }, data: { type: 'agent' } as any },
      ],
      update_nodes: [], remove_nodes: [], add_edges: [], remove_edges: [], rationale: 'good-coords',
    });
    const newNode = useGraphStore.getState().nodes.find((n) => n.id !== 'existing')!;
    expect(newNode.position).not.toEqual({ x: 400, y: 350 });
    expectAlignedToHoneycomb(newNode.position);
  });

  it('places multiple SAMAgent nodes on distinct honeycomb cells', () => {
    useGraphStore.getState().applyPatch({
      add_nodes: [
        { tempId: 'a', type: 'agent', data: { type: 'agent' } as any },
        { tempId: 'p', type: 'provider', data: { type: 'provider' } as any },
        { tempId: 't', type: 'tools', data: { type: 'tools' } as any },
      ],
      update_nodes: [], remove_nodes: [], add_edges: [], remove_edges: [], rationale: 'cluster',
    });
    const nodes = useGraphStore.getState().nodes;
    expect(nodes).toHaveLength(3);
    for (const node of nodes) {
      expectAlignedToHoneycomb(node.position);
    }
    const cells = new Set(nodes.map((node) => `${node.position.x},${node.position.y}`));
    expect(cells.size).toBe(3);
  });
});

describe('graphStore template selection + insertion', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      pendingNameNodeId: null,
    } as any);
    localStorage.clear();
  });

  it('captures only selected nodes and the edges wired between them', () => {
    useGraphStore.setState({
      nodes: [
        { id: 'a', type: 'agent', position: { x: 0, y: 0 }, selected: true, data: { type: 'agent', name: 'A' } as any },
        { id: 's', type: 'storage', position: { x: 100, y: 0 }, selected: true, data: { type: 'storage', storagePath: '~/store' } as any },
        { id: 'unrelated', type: 'tools', position: { x: 0, y: 200 }, selected: false, data: { type: 'tools' } as any },
      ] as any,
      edges: [
        { id: 'e_s_a', source: 's', target: 'a' } as any,
        { id: 'e_unrelated_a', source: 'unrelated', target: 'a' } as any,
      ] as any,
    });

    const tpl = useGraphStore.getState().buildTemplateFromSelection();
    expect(tpl).not.toBeNull();
    expect(tpl!.nodes.map((n) => n.id).sort()).toEqual(['a', 's']);
    // Only the edge wired between selected nodes survives.
    expect(tpl!.edges).toHaveLength(1);
    expect(tpl!.edges[0]).toMatchObject({ source: 's', target: 'a' });
  });

  it('returns null when nothing is selected', () => {
    useGraphStore.setState({
      nodes: [
        { id: 'a', type: 'agent', position: { x: 0, y: 0 }, selected: false, data: { type: 'agent', name: 'A' } as any },
      ] as any,
      edges: [],
    });
    expect(useGraphStore.getState().buildTemplateFromSelection()).toBeNull();
  });

  it('insertTemplate adds nodes with fresh IDs and unique storage paths', () => {
    // Existing graph has one storage node already.
    useGraphStore.setState({
      nodes: [
        {
          id: 'existing',
          type: 'storage',
          position: { x: 0, y: 0 },
          data: { type: 'storage', storagePath: '~/.simple-agent-manager/storage' } as any,
        },
      ] as any,
      edges: [],
    });

    const template = {
      id: 'tpl_x',
      name: 'group',
      description: '',
      createdAt: 0,
      nodes: [
        {
          id: 'orig',
          type: 'storage' as const,
          position: { x: 0, y: 0 },
          data: { type: 'storage', storagePath: '~/.simple-agent-manager/storage' } as any,
        },
      ],
      edges: [],
    };

    const { nodeIds } = useGraphStore.getState().insertTemplate(template);
    expect(nodeIds).toHaveLength(1);

    const nodes = useGraphStore.getState().nodes;
    expect(nodes).toHaveLength(2);
    const inserted = nodes.find((n) => n.id === nodeIds[0])!;
    expect(inserted.id).not.toBe('orig');
    const insertedPath = (inserted.data as { storagePath: string }).storagePath;
    expect(insertedPath).not.toBe('~/.simple-agent-manager/storage');
    expect(insertedPath.startsWith('~/.simple-agent-manager/storage/')).toBe(true);
  });

  it('insertTemplate auto-renames agents to avoid collisions with existing names', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: 'existing',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: { type: 'agent', name: 'Researcher', nameConfirmed: true } as any,
        },
      ] as any,
      edges: [],
    });

    const template = {
      id: 'tpl_x',
      name: 'group',
      description: '',
      createdAt: 0,
      nodes: [
        {
          id: 'orig',
          type: 'agent' as const,
          position: { x: 0, y: 0 },
          data: { type: 'agent', name: 'Researcher', nameConfirmed: true } as any,
        },
      ],
      edges: [],
    };

    useGraphStore.getState().insertTemplate(template);
    useGraphStore.getState().insertTemplate(template);
    const names = useGraphStore
      .getState()
      .nodes.filter((n) => n.data.type === 'agent')
      .map((n) => (n.data as { name: string }).name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('Researcher');
  });
});

describe('graphStore.buildGraphSnapshot', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [{ id: 'a', type: 'agent', position: { x: 1, y: 2 }, data: { type: 'agent', name: 'A' } as any }],
      edges: [{ id: 'e1', source: 'p', target: 'a' } as any],
    });
  });
  it('returns redacted snapshot without positions', () => {
    const snap = useGraphStore.getState().buildGraphSnapshot();
    expect(snap.nodes[0].id).toBe('a');
    expect('position' in snap.nodes[0]).toBe(false);
    expect(snap.edges[0]).toEqual({ id: 'e1', source: 'p', target: 'a' });
  });
});
