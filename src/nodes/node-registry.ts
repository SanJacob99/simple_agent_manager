import AgentNode from './AgentNode';
import MemoryNode from './MemoryNode';
import ToolsNode from './ToolsNode';
import SkillsNode from './SkillsNode';
import ContextEngineNode from './ContextEngineNode';
import AgentCommNode from './AgentCommNode';
import ConnectorsNode from './ConnectorsNode';
import StorageNode from './StorageNode';
import VectorDatabaseNode from './VectorDatabaseNode';
import CronNode from './CronNode';
import ProviderNode from './ProviderNode';

export const nodeTypes = {
  agent: AgentNode,
  memory: MemoryNode,
  tools: ToolsNode,
  skills: SkillsNode,
  contextEngine: ContextEngineNode,
  agentComm: AgentCommNode,
  connectors: ConnectorsNode,
  storage: StorageNode,
  vectorDatabase: VectorDatabaseNode,
  cron: CronNode,
  provider: ProviderNode,
} as const;
