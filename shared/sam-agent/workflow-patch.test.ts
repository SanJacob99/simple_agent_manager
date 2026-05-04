import { describe, it, expect } from 'vitest';
import { redactGraphSnapshot, isWorkflowPatch } from './workflow-patch';

describe('redactGraphSnapshot', () => {
  it('strips React Flow positions', () => {
    const snapshot = redactGraphSnapshot({
      nodes: [{ id: 'n1', type: 'agent', data: { type: 'agent', name: 'A' }, position: { x: 10, y: 20 } } as any],
      edges: [],
    });
    expect((snapshot.nodes[0] as any).position).toBeUndefined();
  });

  it('masks API keys, headers, env values, and tokens', () => {
    const snapshot = redactGraphSnapshot({
      nodes: [{
        id: 'n1', type: 'mcp', data: {
          type: 'mcp',
          apiKey: 'sk-secret',
          headers: { Authorization: 'Bearer xyz' },
          env: { OPENAI_API_KEY: 'real' },
          accessToken: 'abc123',
        },
        position: { x: 0, y: 0 },
      } as any],
      edges: [],
    });
    const data = snapshot.nodes[0].data as any;
    expect(data.apiKey).toBe('[redacted]');
    expect(data.headers.Authorization).toBe('[redacted]');
    expect(data.env.OPENAI_API_KEY).toBe('[redacted]');
    expect(data.accessToken).toBe('[redacted]');
  });

  it('preserves non-secret fields', () => {
    const snapshot = redactGraphSnapshot({
      nodes: [{ id: 'n1', type: 'agent', data: { type: 'agent', name: 'Researcher', modelId: 'claude-sonnet' } as any, position: { x: 0, y: 0 } } as any],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' } as any],
    });
    expect((snapshot.nodes[0].data as any).name).toBe('Researcher');
    expect((snapshot.nodes[0].data as any).modelId).toBe('claude-sonnet');
    expect(snapshot.edges).toEqual([{ id: 'e1', source: 'n1', target: 'n2' }]);
  });
});

describe('isWorkflowPatch', () => {
  it('accepts a complete patch', () => {
    expect(isWorkflowPatch({
      add_nodes: [], update_nodes: [], remove_nodes: [],
      add_edges: [], remove_edges: [], rationale: 'test',
    })).toBe(true);
  });

  it('rejects missing rationale', () => {
    expect(isWorkflowPatch({ add_nodes: [], update_nodes: [], remove_nodes: [], add_edges: [], remove_edges: [] })).toBe(false);
  });

  it('rejects non-object', () => {
    expect(isWorkflowPatch(null)).toBe(false);
    expect(isWorkflowPatch('string')).toBe(false);
  });
});
