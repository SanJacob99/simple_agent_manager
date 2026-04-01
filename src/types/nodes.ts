import type { Node } from '@xyflow/react';
import type { ModelCapabilityOverrides } from './model-metadata';

export type NodeType =
  | 'agent'
  | 'memory'
  | 'tools'
  | 'skills'
  | 'contextEngine'
  | 'agentComm'
  | 'connectors'
  | 'database'
  | 'vectorDatabase';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// --- Agent Node ---

export interface AgentNodeData {
  [key: string]: unknown;
  type: 'agent';
  name: string;
  systemPrompt: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  description: string;
  tags: string[];
  modelCapabilities: ModelCapabilityOverrides;
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

export interface PluginDefinition {
  id: string;
  name: string;
  tools: string[];
  skills: string[];
  enabled: boolean;
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
  systemPromptAdditions: string[];
  autoFlushBeforeCompact: boolean;
  ragEnabled: boolean;
  ragTopK: number;
  ragMinScore: number;
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

// --- Database Node ---

export interface DatabaseNodeData {
  [key: string]: unknown;
  type: 'database';
  label: string;
  dbType: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb' | 'indexeddb' | 'rest-api';
  connectionString: string;
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

// --- Union Types ---

export type FlowNodeData =
  | AgentNodeData
  | MemoryNodeData
  | ToolsNodeData
  | SkillsNodeData
  | ContextEngineNodeData
  | AgentCommNodeData
  | ConnectorsNodeData
  | DatabaseNodeData
  | VectorDatabaseNodeData;

export type AppNode = Node<FlowNodeData>;
