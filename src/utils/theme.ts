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

export const NODE_PASTEL: Record<NodeType, { bg: string; fg: string }> = {
  agent:          { bg: '#E8DCFB', fg: '#7A4FD6' },
  memory:         { bg: '#D8F0D5', fg: '#3FA84A' },
  tools:          { bg: '#FBE0CB', fg: '#E97A2C' },
  skills:         { bg: '#D4ECF7', fg: '#2D9CDB' },
  contextEngine:  { bg: '#EFE4C7', fg: '#C9A23B' },
  agentComm:      { bg: '#F8D8E0', fg: '#E0507A' },
  connectors:     { bg: '#FBEBC0', fg: '#E8B83A' },
  storage:        { bg: '#F8C9C5', fg: '#E25A4F' },
  vectorDatabase: { bg: '#CFEFD9', fg: '#2FA964' },
  cron:           { bg: '#E5F4D0', fg: '#7AAB2C' },
  provider:       { bg: '#D8D5F5', fg: '#4F5BD6' },
  mcp:            { bg: '#CFE9E2', fg: '#2FA8A1' },
  subAgent:       { bg: '#E8DCFB', fg: '#9450C9' },
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
