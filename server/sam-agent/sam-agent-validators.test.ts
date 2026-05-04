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
});
