import type { Node } from '@xyflow/react';

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

export interface AgentNodeData {
  [key: string]: unknown;
  type: 'agent';
  name: string;
  systemPrompt: string;
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
}

export interface MemoryNodeData {
  [key: string]: unknown;
  type: 'memory';
  label: string;
  maxMessages: number;
  persistAcrossSessions: boolean;
}

export interface ToolsNodeData {
  [key: string]: unknown;
  type: 'tools';
  label: string;
  enabledTools: string[];
}

export interface SkillsNodeData {
  [key: string]: unknown;
  type: 'skills';
  label: string;
  enabledSkills: string[];
}

export interface ContextEngineNodeData {
  [key: string]: unknown;
  type: 'contextEngine';
  label: string;
  strategy: 'rag' | 'summary' | 'sliding-window';
  maxTokens: number;
}

export interface AgentCommNodeData {
  [key: string]: unknown;
  type: 'agentComm';
  label: string;
  targetAgentNodeId: string | null;
  protocol: 'direct' | 'broadcast';
}

export interface ConnectorsNodeData {
  [key: string]: unknown;
  type: 'connectors';
  label: string;
  connectorType: string;
  config: Record<string, string>;
}

export interface DatabaseNodeData {
  [key: string]: unknown;
  type: 'database';
  label: string;
  dbType: 'postgresql' | 'mysql' | 'sqlite' | 'mongodb';
  connectionString: string;
}

export interface VectorDatabaseNodeData {
  [key: string]: unknown;
  type: 'vectorDatabase';
  label: string;
  provider: 'pinecone' | 'chromadb' | 'qdrant' | 'weaviate';
  collectionName: string;
  connectionString: string;
}

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
