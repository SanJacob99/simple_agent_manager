import { describe, it, expect } from 'vitest';
import { buildSamAgentSystemPrompt, SAM_AGENT_BASE_PROMPT } from './sam-agent-system-prompt';
import type { GraphSnapshot } from '../../shared/sam-agent/workflow-patch';

const emptyGraph: GraphSnapshot = { nodes: [], edges: [] };

describe('buildSamAgentSystemPrompt', () => {
  it('includes the base identity prompt', () => {
    const result = buildSamAgentSystemPrompt(emptyGraph);
    expect(result).toContain('You are SAMAgent');
  });

  it('includes connection rules covering peripheral->agent and sub-agent peripherals', () => {
    const result = buildSamAgentSystemPrompt(emptyGraph);
    expect(result).toMatch(/peripheral.*agent.*subAgent/i);
    expect(result).toMatch(/tools, provider, skills, mcp/);
  });

  it('embeds the current graph snapshot under <current_graph>', () => {
    const result = buildSamAgentSystemPrompt({
      nodes: [{ id: 'a1', type: 'agent', data: { type: 'agent', name: 'My' } }],
      edges: [],
    });
    expect(result).toMatch(/<current_graph>/);
    expect(result).toMatch(/a1/);
    expect(result).toMatch(/<\/current_graph>/);
  });

  it('exports the static base prompt for inspection', () => {
    expect(SAM_AGENT_BASE_PROMPT.length).toBeGreaterThan(500);
    expect(SAM_AGENT_BASE_PROMPT).toContain('propose_workflow_patch');
  });
});
