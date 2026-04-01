import type { NodeType, FlowNodeData } from '../types/nodes';

export function getDefaultNodeData(nodeType: NodeType): FlowNodeData {
  switch (nodeType) {
    case 'agent':
      return {
        type: 'agent',
        name: 'New Agent',
        systemPrompt: 'You are a helpful assistant.',
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-20250514',
        thinkingLevel: 'off',
      };
    case 'memory':
      return {
        type: 'memory',
        label: 'Memory',
        maxMessages: 100,
        persistAcrossSessions: false,
      };
    case 'tools':
      return {
        type: 'tools',
        label: 'Tools',
        enabledTools: ['read_file', 'write_file', 'web_search'],
      };
    case 'skills':
      return {
        type: 'skills',
        label: 'Skills',
        enabledSkills: ['code_generation', 'summarization'],
      };
    case 'contextEngine':
      return {
        type: 'contextEngine',
        label: 'Context Engine',
        strategy: 'sliding-window',
        maxTokens: 4096,
      };
    case 'agentComm':
      return {
        type: 'agentComm',
        label: 'Agent Comm',
        targetAgentNodeId: null,
        protocol: 'direct',
      };
    case 'connectors':
      return {
        type: 'connectors',
        label: 'Connector',
        connectorType: 'rest-api',
        config: {},
      };
    case 'database':
      return {
        type: 'database',
        label: 'Database',
        dbType: 'postgresql',
        connectionString: '',
      };
    case 'vectorDatabase':
      return {
        type: 'vectorDatabase',
        label: 'Vector DB',
        provider: 'chromadb',
        collectionName: 'default',
        connectionString: '',
      };
  }
}
