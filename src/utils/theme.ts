import type { NodeType } from '../types/nodes';

export const NODE_COLORS: Record<NodeType, string> = {
  agent: 'var(--c-node-agent)',
  memory: 'var(--c-node-memory)',
  tools: 'var(--c-node-tools)',
  skills: 'var(--c-node-skills)',
  contextEngine: 'var(--c-node-context)',
  agentComm: 'var(--c-node-comm)',
  connectors: 'var(--c-node-connectors)',
  storage: 'var(--c-node-storage)',
  vectorDatabase: 'var(--c-node-vectordb)',
  cron: 'var(--c-node-cron)',
  provider: 'var(--c-node-provider)',
  mcp: 'var(--c-node-mcp)',
  subAgent: 'var(--c-node-subagent)',
};

export const NODE_LABELS: Record<NodeType, string> = {
  agent: 'Agent',
  memory: 'Memory',
  tools: 'Tools',
  skills: 'Skills',
  contextEngine: 'Context Engine',
  agentComm: 'Agent Comm',
  connectors: 'Connectors',
  storage: 'Storage',
  vectorDatabase: 'Vector DB',
  cron: 'Cron',
  provider: 'Provider',
  mcp: 'MCP',
  subAgent: 'Sub-Agent',
};
