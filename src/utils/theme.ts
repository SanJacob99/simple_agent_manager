import type { NodeType } from '../types/nodes';

export const NODE_COLORS: Record<NodeType, string> = {
  agent: '#3b82f6',
  memory: '#22c55e',
  tools: '#f97316',
  skills: '#a855f7',
  contextEngine: '#06b6d4',
  agentComm: '#ec4899',
  connectors: '#eab308',
  database: '#ef4444',
  vectorDatabase: '#14b8a6',
};

export const NODE_LABELS: Record<NodeType, string> = {
  agent: 'Agent',
  memory: 'Memory',
  tools: 'Tools',
  skills: 'Skills',
  contextEngine: 'Context Engine',
  agentComm: 'Agent Comm',
  connectors: 'Connectors',
  database: 'Database',
  vectorDatabase: 'Vector DB',
};
