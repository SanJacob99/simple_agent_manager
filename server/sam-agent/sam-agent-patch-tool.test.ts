import { describe, it, expect } from 'vitest';
import { buildProposePatchTool } from './sam-agent-patch-tool';
import type { GraphSnapshot } from '../../shared/sam-agent/workflow-patch';

const emptyGraph: GraphSnapshot = { nodes: [], edges: [] };

describe('propose_workflow_patch tool', () => {
  it('returns the validated patch as the tool result on success', async () => {
    const tool = buildProposePatchTool({ getSnapshot: () => emptyGraph });
    const result = await tool.execute('id1', {
      add_nodes: [
        { tempId: 'a', type: 'agent', data: { type: 'agent', name: 'A' } },
        { tempId: 'p', type: 'provider', data: { type: 'provider', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' } },
        { tempId: 's', type: 'storage', data: { type: 'storage' } },
        { tempId: 'c', type: 'contextEngine', data: { type: 'contextEngine' } },
      ],
      update_nodes: [], remove_nodes: [],
      add_edges: [
        { source: 'p', target: 'a' },
        { source: 's', target: 'a' },
        { source: 'c', target: 'a' },
      ],
      remove_edges: [], rationale: 'build an agent',
    }, new AbortController().signal);
    const text = (result as any).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.patch.add_nodes).toHaveLength(4);
  });

  it('returns errors as the tool result on validation failure', async () => {
    const tool = buildProposePatchTool({ getSnapshot: () => emptyGraph });
    const result = await tool.execute('id2', {
      add_nodes: [{ tempId: 'a', type: 'agent', data: { type: 'agent', name: 'A' } }],
      update_nodes: [], remove_nodes: [], add_edges: [], remove_edges: [],
      rationale: 'incomplete',
    }, new AbortController().signal);
    const text = (result as any).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it('returns shape error when input is not a WorkflowPatch', async () => {
    const tool = buildProposePatchTool({ getSnapshot: () => emptyGraph });
    const result = await tool.execute('id3', { not: 'a patch' }, new AbortController().signal);
    const text = (result as any).content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.some((e: any) => e.code === 'invalid_shape')).toBe(true);
  });
});
