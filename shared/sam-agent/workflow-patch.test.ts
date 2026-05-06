import { describe, it, expect } from 'vitest';
import { redactGraphSnapshot, isWorkflowPatch } from './workflow-patch';

describe('redactGraphSnapshot', () => {
  it('strips React Flow positions', () => {
    const snapshot = redactGraphSnapshot({
      nodes: [{ id: 'n1', type: 'agent', data: { type: 'agent', name: 'A' }, position: { x: 10, y: 20 } } as any],
      edges: [],
    });
    expect('position' in snapshot.nodes[0]).toBe(false);
  });

  it('masks exact-match secret keys and their string descendants', () => {
    const snapshot = redactGraphSnapshot({
      nodes: [{
        id: 'n1', type: 'mcp', data: {
          type: 'mcp',
          apiKey: 'sk-secret',
          headers: { Authorization: 'Bearer xyz' },
          secret: 'sensitive',
          accessToken: 'abc123',
        },
        position: { x: 0, y: 0 },
      } as any],
      edges: [],
    });
    const data = snapshot.nodes[0].data as any;
    expect(data.apiKey).toBe('[redacted]');
    expect(data.headers.Authorization).toBe('[redacted]');
    expect(data.secret).toBe('[redacted]');
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

  it('redacts string values inside arrays under secret-keyed parents', () => {
    const snapshot = redactGraphSnapshot({
      nodes: [{
        id: 'n1', type: 'mcp', data: {
          type: 'mcp',
          apiKeys: ['sk-aaa', 'sk-bbb'],
        },
      }],
      edges: [],
    });
    const data = snapshot.nodes[0].data as any;
    expect(data.apiKeys).toEqual(['[redacted]', '[redacted]']);
  });

  it('redacts string values inside arrays of objects under secret-keyed parents', () => {
    const snapshot = redactGraphSnapshot({
      nodes: [{
        id: 'n1', type: 'mcp', data: {
          type: 'mcp',
          tokens: [{ name: 'Authorization', value: 'Bearer xyz' }, { name: 'X-Custom', value: 'plain' }],
        },
      }],
      edges: [],
    });
    const data = snapshot.nodes[0].data as any;
    // Once we descend into the secret-keyed `tokens`, ALL string descendants are redacted.
    expect(data.tokens[0].name).toBe('[redacted]');
    expect(data.tokens[0].value).toBe('[redacted]');
    expect(data.tokens[1].name).toBe('[redacted]');
    expect(data.tokens[1].value).toBe('[redacted]');
  });

  it('preserves non-secret nested objects', () => {
    const snapshot = redactGraphSnapshot({
      nodes: [{
        id: 'n1', type: 'mcp', data: {
          type: 'mcp',
          config: { host: 'example.com', region: 'us-east' },
          tokenBudget: 8000,
          tokenizer: 'cl100k',
        },
      }],
      edges: [],
    });
    const data = snapshot.nodes[0].data as any;
    expect(data.config).toEqual({ host: 'example.com', region: 'us-east' });
    expect(data.tokenBudget).toBe(8000);
    expect(data.tokenizer).toBe('cl100k');
  });

  it('synthesizes an edge id when input edge has none', () => {
    const snapshot = redactGraphSnapshot({
      nodes: [],
      edges: [{ source: 'a', target: 'b' } as any],
    });
    expect(snapshot.edges[0].id).toBeTruthy();
    expect(snapshot.edges[0].source).toBe('a');
    expect(snapshot.edges[0].target).toBe('b');
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
