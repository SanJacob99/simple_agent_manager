import type { NodeType } from '../types/nodes';

export const NODE_COLORS: Record<NodeType, string> = {
  agent: '#3b82f6',
  memory: '#22c55e',
  tools: '#f97316',
  skills: '#a855f7',
  contextEngine: '#06b6d4',
  agentComm: '#ec4899',
  connectors: '#eab308',
  storage: '#ef4444',
  vectorDatabase: '#14b8a6',
  cron: '#8b5cf6',
  provider: '#6366f1',
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
};
