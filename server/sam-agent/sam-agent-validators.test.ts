import { describe, it, expect } from 'vitest';
import { validateWorkflowPatch } from './sam-agent-validators';
import type { GraphSnapshot } from '../../shared/sam-agent/workflow-patch';

const emptyGraph: GraphSnapshot = { nodes: [], edges: [] };

const completeAgentGraph: GraphSnapshot = {
  nodes: [
    { id: 'a1', type: 'agent', data: { type: 'agent', name: 'A', modelId: 'm', systemPrompt: 'x', thinkingLevel: 'off', systemPromptMode: 'append', modelCapabilities: {}, description: '', tags: [], showReasoning: false, verbose: false, workingDirectory: '', nameConfirmed: true } },
    { id: 'p1', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' } },
    { id: 's1', type: 'storage', data: { type: 'storage' } },
    { id: 'c1', type: 'contextEngine', data: { type: 'contextEngine' } },
  ],
  edges: [
    { id: 'e1', source: 'p1', target: 'a1' },
    { id: 'e2', source: 's1', target: 'a1' },
    { id: 'e3', source: 'c1', target: 'a1' },
  ],
};

describe('validateWorkflowPatch', () => {
  it('accepts an empty patch', () => {
    const r = validateWorkflowPatch(
      { add_nodes: [], update_nodes: [], remove_nodes: [], add_edges: [], remove_edges: [], rationale: 'noop' },
      emptyGraph,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects update for a non-existent node', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [], update_nodes: [{ id: 'missing', dataPatch: {} as any }],
        remove_nodes: [], add_edges: [], remove_edges: [], rationale: 'fail',
      },
      emptyGraph,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'unknown_node_id')).toBe(true);
  });

  it('rejects an add_edge with peripheral->peripheral', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [
          { tempId: 'p', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' } as any },
          { tempId: 's', type: 'storage', data: { type: 'storage' } as any },
        ],
        update_nodes: [], remove_nodes: [],
        add_edges: [{ source: 'p', target: 's' }],
        remove_edges: [], rationale: 'bad',
      },
      emptyGraph,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'invalid_edge')).toBe(true);
  });

  it('rejects creating an agent without provider/storage/contextEngine', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [{ tempId: 'a', type: 'agent', data: { type: 'agent', name: 'A' } as any }],
        update_nodes: [], remove_nodes: [], add_edges: [], remove_edges: [], rationale: 'incomplete',
      },
      emptyGraph,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === 'agent_missing_provider')).toBe(true);
      expect(r.errors.some((e) => e.code === 'agent_missing_storage')).toBe(true);
      expect(r.errors.some((e) => e.code === 'agent_missing_context_engine')).toBe(true);
    }
  });

  it('accepts a complete agent build via tempIds', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [
          { tempId: 'a', type: 'agent', data: { type: 'agent', name: 'A', modelId: 'm', systemPrompt: 'x' } as any },
          { tempId: 'p', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' } as any },
          { tempId: 's', type: 'storage', data: { type: 'storage' } as any },
          { tempId: 'c', type: 'contextEngine', data: { type: 'contextEngine' } as any },
        ],
        update_nodes: [], remove_nodes: [],
        add_edges: [
          { source: 'p', target: 'a' },
          { source: 's', target: 'a' },
          { source: 'c', target: 'a' },
        ],
        remove_edges: [], rationale: 'build',
      },
      emptyGraph,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects subAgent peripheral that is not in the allowed set', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [
          { tempId: 'sa', type: 'subAgent', data: { type: 'subAgent' } as any },
          { tempId: 's', type: 'storage', data: { type: 'storage' } as any },
        ],
        update_nodes: [], remove_nodes: [],
        add_edges: [{ source: 's', target: 'sa' }],
        remove_edges: [], rationale: 'bad',
      },
      emptyGraph,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'invalid_edge')).toBe(true);
  });

  it('rejects unknown node type', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [{ tempId: 'x', type: 'fakeNode' as any, data: {} as any }],
        update_nodes: [], remove_nodes: [], add_edges: [], remove_edges: [], rationale: 'bad',
      },
      emptyGraph,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'unknown_node_type')).toBe(true);
  });

  it('rejects updating a removed node', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [], update_nodes: [{ id: 'a1', dataPatch: { name: 'X' } as any }],
        remove_nodes: ['a1'],
        add_edges: [], remove_edges: [], rationale: 'conflicting',
      },
      completeAgentGraph,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'update_then_remove')).toBe(true);
  });

  it('rejects orphan edges left behind when a node is removed', () => {
    const graph = {
      nodes: [
        { id: 'a', type: 'agent', data: { type: 'agent' } },
        { id: 'p', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' } },
      ],
      edges: [{ id: 'e1', source: 'p', target: 'a' }],
    };
    const r = validateWorkflowPatch(
      {
        add_nodes: [], update_nodes: [],
        remove_nodes: ['p'],     // remove the provider but keep edge e1
        add_edges: [], remove_edges: [],
        rationale: 'orphan',
      },
      graph,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'dangling_edge')).toBe(true);
  });

  it('rejects a touched subAgent that is not referenced by any parent', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [
          { tempId: 'sa', type: 'subAgent', data: { type: 'subAgent' } as any },
          { tempId: 't', type: 'tools', data: { type: 'tools' } as any },
        ],
        update_nodes: [], remove_nodes: [],
        add_edges: [{ source: 't', target: 'sa' }],
        remove_edges: [], rationale: 'orphan-subagent',
      },
      { nodes: [], edges: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'subagent_not_referenced')).toBe(true);
  });

  it('accepts a subAgent referenced via parent agent.data.subAgents (string id)', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [
          { tempId: 'a', type: 'agent', data: { type: 'agent', subAgents: ['sa'] } as any },
          { tempId: 'p', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' } as any },
          { tempId: 's', type: 'storage', data: { type: 'storage' } as any },
          { tempId: 'c', type: 'contextEngine', data: { type: 'contextEngine' } as any },
          { tempId: 'sa', type: 'subAgent', data: { type: 'subAgent' } as any },
          { tempId: 't', type: 'tools', data: { type: 'tools' } as any },
        ],
        update_nodes: [], remove_nodes: [],
        add_edges: [
          { source: 'p', target: 'a' },
          { source: 's', target: 'a' },
          { source: 'c', target: 'a' },
          { source: 't', target: 'sa' },
        ],
        remove_edges: [], rationale: 'parent-with-sub',
      },
      { nodes: [], edges: [] },
    );
    expect(r.ok).toBe(true);
  });

  it('rejects subAgent without a connected tools node', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [
          { tempId: 'a', type: 'agent', data: { type: 'agent', subAgents: ['sa'] } as any },
          { tempId: 'p', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' } as any },
          { tempId: 's', type: 'storage', data: { type: 'storage' } as any },
          { tempId: 'c', type: 'contextEngine', data: { type: 'contextEngine' } as any },
          { tempId: 'sa', type: 'subAgent', data: { type: 'subAgent' } as any },
        ],
        update_nodes: [], remove_nodes: [],
        add_edges: [
          { source: 'p', target: 'a' },
          { source: 's', target: 'a' },
          { source: 'c', target: 'a' },
        ],
        remove_edges: [], rationale: 'sub-no-tools',
      },
      { nodes: [], edges: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'subagent_missing_tools')).toBe(true);
  });

  it('rejects an agent with multiple providers connected', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [
          { tempId: 'a', type: 'agent', data: { type: 'agent' } as any },
          { tempId: 'p1', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'X', baseUrl: '' } as any },
          { tempId: 'p2', type: 'provider', data: { type: 'provider', pluginId: 'anthropic', authMethodId: 'api-key', envVar: 'Y', baseUrl: '' } as any },
          { tempId: 's', type: 'storage', data: { type: 'storage' } as any },
          { tempId: 'c', type: 'contextEngine', data: { type: 'contextEngine' } as any },
        ],
        update_nodes: [], remove_nodes: [],
        add_edges: [
          { source: 'p1', target: 'a' },
          { source: 'p2', target: 'a' },
          { source: 's', target: 'a' },
          { source: 'c', target: 'a' },
        ],
        remove_edges: [], rationale: 'two-providers',
      },
      { nodes: [], edges: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'agent_multiple_providers')).toBe(true);
  });

  it('rejects a self-edge', () => {
    const r = validateWorkflowPatch(
      {
        add_nodes: [
          { tempId: 'a', type: 'agent', data: { type: 'agent' } as any },
        ],
        update_nodes: [], remove_nodes: [],
        add_edges: [{ source: 'a', target: 'a' }],
        remove_edges: [], rationale: 'self-loop',
      },
      { nodes: [], edges: [] },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === 'self_edge')).toBe(true);
  });

  it('node.type and node.data.type stay in sync after add', () => {
    // Regression test for spread-precedence bug: even if add.data.type
    // disagrees with add.type, the validator must use add.type as
    // canonical (and the resulting node.data.type should match).
    // Easiest behavioural assertion: a patch where add.data.type is wrong
    // but add.type is right should still pass type checks.
    const r = validateWorkflowPatch(
      {
        add_nodes: [
          { tempId: 'a', type: 'agent', data: { type: 'storage' } as any },  // mismatched on purpose
          { tempId: 'p', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' } as any },
          { tempId: 's', type: 'storage', data: { type: 'storage' } as any },
          { tempId: 'c', type: 'contextEngine', data: { type: 'contextEngine' } as any },
        ],
        update_nodes: [], remove_nodes: [],
        add_edges: [
          { source: 'p', target: 'a' },
          { source: 's', target: 'a' },
          { source: 'c', target: 'a' },
        ],
        remove_edges: [], rationale: 'test',
      },
      { nodes: [], edges: [] },
    );
    expect(r.ok).toBe(true);  // because the resolver should treat 'a' as agent (using add.type), not storage
  });
});
