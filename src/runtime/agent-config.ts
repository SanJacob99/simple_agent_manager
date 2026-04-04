import type {
  MemoryBackend,
  ToolProfile,
  ToolGroup,
  SkillDefinition,
  PluginDefinition,
  CompactionStrategy,
} from '../types/nodes';
import type { ModelCapabilityOverrides } from '../types/model-metadata';

export interface AgentConfig {
  id: string;
  version: number;
  name: string;
  description: string;
  tags: string[];

  provider: string;
  modelId: string;
  thinkingLevel: string;
  systemPrompt: string;
  modelCapabilities: ModelCapabilityOverrides;

  memory: ResolvedMemoryConfig | null;
  tools: ResolvedToolsConfig | null;
  contextEngine: ResolvedContextEngineConfig | null;
  connectors: ResolvedConnectorConfig[];
  agentComm: ResolvedAgentCommConfig[];
  storage: ResolvedStorageConfig | null;
  vectorDatabases: ResolvedVectorDatabaseConfig[];

  exportedAt: number;
  sourceGraphId: string;
}

export interface ResolvedMemoryConfig {
  backend: MemoryBackend;
  maxSessionMessages: number;
  persistAcrossSessions: boolean;
  compactionEnabled: boolean;
  compactionThreshold: number;
  compactionStrategy: string;
  exposeMemorySearch: boolean;
  exposeMemoryGet: boolean;
  exposeMemorySave: boolean;
  searchMode: string;
  externalEndpoint: string;
  externalApiKey: string;
}

export interface ResolvedToolsConfig {
  profile: ToolProfile;
  resolvedTools: string[];
  enabledGroups: ToolGroup[];
  skills: SkillDefinition[];
  plugins: PluginDefinition[];
  subAgentSpawning: boolean;
  maxSubAgents: number;
}

export interface ResolvedContextEngineConfig {
  tokenBudget: number;
  reservedForResponse: number;
  ownsCompaction: boolean;
  compactionStrategy: CompactionStrategy;
  compactionTrigger: string;
  compactionThreshold: number;
  systemPromptAdditions: string[];
  autoFlushBeforeCompact: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  ragMinScore: number;
}

export interface ResolvedConnectorConfig {
  label: string;
  connectorType: string;
  config: Record<string, string>;
}

export interface ResolvedAgentCommConfig {
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
}

export interface ResolvedStorageConfig {
  label: string;
  backendType: 'filesystem';
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;
}

export interface ResolvedVectorDatabaseConfig {
  label: string;
  provider: string;
  collectionName: string;
  connectionString: string;
}
