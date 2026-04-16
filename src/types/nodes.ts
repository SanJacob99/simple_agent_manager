import type { Node } from '@xyflow/react';
import type { ModelCapabilityOverrides } from './model-metadata';
import type { SystemPromptMode } from '../../shared/agent-config';

export type NodeType =
  | 'agent'
  | 'memory'
  | 'tools'
  | 'skills'
  | 'contextEngine'
  | 'agentComm'
  | 'connectors'
  | 'storage'
  | 'vectorDatabase'
  | 'cron'
  | 'provider';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// --- Agent Node ---

export interface AgentNodeData {
  [key: string]: unknown;
  type: 'agent';
  name: string;
  nameConfirmed: boolean;
  systemPrompt: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  description: string;
  tags: string[];
  modelCapabilities: ModelCapabilityOverrides;
  systemPromptMode: SystemPromptMode;
  showReasoning: boolean;
  verbose: boolean;
}

// --- Memory Node (OpenClaw-inspired) ---

export type MemoryBackend = 'builtin' | 'external' | 'cloud';

export interface MemoryNodeData {
  [key: string]: unknown;
  type: 'memory';
  label: string;
  backend: MemoryBackend;
  maxSessionMessages: number;
  persistAcrossSessions: boolean;
  compactionEnabled: boolean;
  compactionStrategy: 'summary' | 'sliding-window' | 'hybrid';
  compactionThreshold: number;
  exposeMemorySearch: boolean;
  exposeMemoryGet: boolean;
  exposeMemorySave: boolean;
  searchMode: 'keyword' | 'semantic' | 'hybrid';
  externalEndpoint: string;
  externalApiKey: string;
}

// --- Tools Node (OpenClaw-inspired) ---

export type ToolProfile = 'full' | 'coding' | 'messaging' | 'minimal' | 'custom';
export type ToolGroup = 'runtime' | 'fs' | 'web' | 'memory' | 'coding' | 'communication';

export interface SkillDefinition {
  id: string;
  name: string;
  content: string;
  injectAs: 'system-prompt' | 'user-context';
}

export interface PluginHookBinding {
  hookName: string;
  handler: string;
  priority?: number;
  critical?: boolean;
}

export interface PluginDefinition {
  id: string;
  name: string;
  tools: string[];
  skills: string[];
  hooks?: PluginHookBinding[];
  enabled: boolean;
}

export interface ExecToolSettings {
  /** Working directory for shell commands. Empty string = server process.cwd() */
  cwd: string;
  /** When true, workdir param is constrained to stay within cwd */
  sandboxWorkdir: boolean;
  /** Markdown guidance injected into the system prompt for this tool */
  skill: string;
}

export interface CodeExecutionToolSettings {
  /** xAI API key (or env var name). Empty = reads XAI_API_KEY from environment */
  apiKey: string;
  /** xAI model override (defaults to grok-4-1-fast) */
  model: string;
  /** Markdown guidance injected into the system prompt for this tool */
  skill: string;
}

export interface ToolSettings {
  exec: ExecToolSettings;
  codeExecution: CodeExecutionToolSettings;
}

export interface ToolsNodeData {
  [key: string]: unknown;
  type: 'tools';
  label: string;
  profile: ToolProfile;
  enabledTools: string[];
  enabledGroups: ToolGroup[];
  skills: SkillDefinition[];
  plugins: PluginDefinition[];
  subAgentSpawning: boolean;
  maxSubAgents: number;
  toolSettings: ToolSettings;
}

// --- Skills Node ---

export interface SkillsNodeData {
  [key: string]: unknown;
  type: 'skills';
  label: string;
  enabledSkills: string[];
}

// --- Context Engine Node (OpenClaw-inspired) ---

export type CompactionStrategy = 'summary' | 'sliding-window' | 'trim-oldest' | 'hybrid';

export interface ContextEngineNodeData {
  [key: string]: unknown;
  type: 'contextEngine';
  label: string;
  tokenBudget: number;
  reservedForResponse: number;
  ownsCompaction: boolean;
  compactionStrategy: CompactionStrategy;
  compactionTrigger: 'auto' | 'manual' | 'threshold';
  compactionThreshold: number;
  autoFlushBeforeCompact: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  ragMinScore: number;
  bootstrapMaxChars: number;
  bootstrapTotalMaxChars: number;
}

// --- Agent Communication Node ---

export interface AgentCommNodeData {
  [key: string]: unknown;
  type: 'agentComm';
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
}

// --- Connectors Node ---

export interface ConnectorsNodeData {
  [key: string]: unknown;
  type: 'connectors';
  label: string;
  connectorType: string;
  config: Record<string, string>;
}

// --- Storage Node ---

export type StorageBackend = 'filesystem';

export interface StorageNodeData {
  [key: string]: unknown;
  type: 'storage';
  label: string;
  backendType: StorageBackend;
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;
  dailyResetEnabled: boolean;
  dailyResetHour: number;
  idleResetEnabled: boolean;
  idleResetMinutes: number;
  parentForkMaxTokens: number;
  // Maintenance
  maintenanceMode: 'warn' | 'enforce';
  pruneAfterDays: number;
  maxEntries: number;
  rotateBytes: number;
  resetArchiveRetentionDays: number;
  maxDiskBytes: number;
  highWaterPercent: number;
  maintenanceIntervalMinutes: number;
}

// --- Vector Database Node ---

export interface VectorDatabaseNodeData {
  [key: string]: unknown;
  type: 'vectorDatabase';
  label: string;
  provider: 'pinecone' | 'chromadb' | 'qdrant' | 'weaviate';
  collectionName: string;
  connectionString: string;
}

// --- Cron Node ---

export interface CronNodeData {
  [key: string]: unknown;
  type: 'cron';
  label: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  sessionMode: 'persistent' | 'ephemeral';
  timezone: string;
  maxRunDurationMs: number;
  retentionDays: number;
}

// --- Provider Node ---

export interface ProviderNodeData {
  [key: string]: unknown;
  type: 'provider';
  label: string;
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string;
}

// --- Union Types ---

export type FlowNodeData =
  | AgentNodeData
  | MemoryNodeData
  | ToolsNodeData
  | SkillsNodeData
  | ContextEngineNodeData
  | AgentCommNodeData
  | ConnectorsNodeData
  | StorageNodeData
  | VectorDatabaseNodeData
  | CronNodeData
  | ProviderNodeData;

export type AppNode = Node<FlowNodeData>;
