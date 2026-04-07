import type { NodeType, FlowNodeData } from '../types/nodes';
import type { SystemPromptMode } from '../../shared/agent-config';

export function getDefaultNodeData(nodeType: NodeType): FlowNodeData {
  switch (nodeType) {
    case 'agent':
      return {
        type: 'agent',
        name: '',
        nameConfirmed: false,
        systemPrompt: 'You are a helpful assistant.',
        provider: 'openrouter',
        modelId: 'anthropic/claude-sonnet-4-20250514',
        thinkingLevel: 'off',
        description: '',
        tags: [],
        modelCapabilities: {},
        systemPromptMode: 'append' as SystemPromptMode,
        showReasoning: false,
        verbose: false,
      };
    case 'memory':
      return {
        type: 'memory',
        label: 'Memory',
        backend: 'builtin',
        maxSessionMessages: 100,
        persistAcrossSessions: false,
        compactionEnabled: false,
        compactionStrategy: 'summary',
        compactionThreshold: 0.8,
        exposeMemorySearch: true,
        exposeMemoryGet: true,
        exposeMemorySave: true,
        searchMode: 'hybrid',
        externalEndpoint: '',
        externalApiKey: '',
      };
    case 'tools':
      return {
        type: 'tools',
        label: 'Tools',
        profile: 'full',
        enabledTools: [],
        enabledGroups: [],
        skills: [],
        plugins: [],
        subAgentSpawning: false,
        maxSubAgents: 3,
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
        tokenBudget: 128000,
        reservedForResponse: 4096,
        ownsCompaction: true,
        compactionStrategy: 'trim-oldest',
        compactionTrigger: 'auto',
        compactionThreshold: 0.8,
        autoFlushBeforeCompact: true,
        ragEnabled: false,
        ragTopK: 5,
        ragMinScore: 0.7,
        bootstrapMaxChars: 20000,
        bootstrapTotalMaxChars: 150000,
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
    case 'storage':
      return {
        type: 'storage',
        label: 'Storage',
        backendType: 'filesystem',
        storagePath: '~/.simple-agent-manager/storage',
        sessionRetention: 50,
        memoryEnabled: true,
        dailyMemoryEnabled: true,
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
