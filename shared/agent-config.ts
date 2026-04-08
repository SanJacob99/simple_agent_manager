// --- Shared type aliases (duplicated from src/types/ to keep shared/ self-contained) ---

export type MemoryBackend = 'builtin' | 'external' | 'cloud';
export type ToolProfile = 'full' | 'coding' | 'messaging' | 'minimal' | 'custom';
export type ToolGroup = 'runtime' | 'fs' | 'web' | 'memory' | 'coding' | 'communication';
export type CompactionStrategy = 'summary' | 'sliding-window' | 'trim-oldest' | 'hybrid';

export type SystemPromptMode = 'auto' | 'append' | 'manual';

export interface SystemPromptSection {
  key: string;
  label: string;
  content: string;
  tokenEstimate: number;
}

export interface ResolvedSystemPrompt {
  mode: SystemPromptMode;
  sections: SystemPromptSection[];
  assembled: string;
  userInstructions: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  content: string;
  injectAs: 'system-prompt' | 'user-context';
}

export interface PluginHookBinding {
  hookName: string;
  handler: string;       // module path (relative to storage or absolute)
  priority?: number;     // default: 100
  critical?: boolean;    // default: false
}

export interface PluginDefinition {
  id: string;
  name: string;
  tools: string[];
  skills: string[];
  hooks?: PluginHookBinding[];
  enabled: boolean;
}

export type ModelInputModality = 'text' | 'image';

export interface ModelCostInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelTopProviderInfo {
  contextLength?: number;
  maxCompletionTokens?: number;
  isModerated?: boolean;
}

export interface ModelCapabilityOverrides {
  reasoningSupported?: boolean;
  inputModalities?: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCostInfo;
  outputModalities?: string[];
  tokenizer?: string;
  supportedParameters?: string[];
  topProvider?: ModelTopProviderInfo;
  description?: string;
  modelName?: string;
}

export interface DiscoveredModelMetadata {
  id: string;
  provider: string;
  reasoningSupported?: boolean;
  inputModalities?: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCostInfo;
  outputModalities?: string[];
  tokenizer?: string;
  supportedParameters?: string[];
  topProvider?: ModelTopProviderInfo;
}

// --- Agent Config interfaces ---

export interface AgentConfig {
  id: string;
  version: number;
  name: string;
  description: string;
  tags: string[];

  provider: string;
  modelId: string;
  thinkingLevel: string;
  systemPrompt: ResolvedSystemPrompt;
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
  runTimeoutMs: number;
  showReasoning?: boolean;
  verbose?: boolean;
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
  dailyResetEnabled: boolean;
  dailyResetHour: number;
  idleResetEnabled: boolean;
  idleResetMinutes: number;
  parentForkMaxTokens: number;
}

export interface ResolvedVectorDatabaseConfig {
  label: string;
  provider: string;
  collectionName: string;
  connectionString: string;
}
