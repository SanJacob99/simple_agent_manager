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
import MCPNode from './MCPNode';
import SubAgentNode from './SubAgentNode';
import GuardrailsNode from './GuardrailsNode';
import TelemetryNode from './TelemetryNode';
import StructuredOutputNode from './StructuredOutputNode';
import BudgetNode from './BudgetNode';
import EvalsNode from './EvalsNode';
import ReflectionNode from './ReflectionNode';
import SandboxNode from './SandboxNode';

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
  mcp: MCPNode,
  subAgent: SubAgentNode,
  guardrails: GuardrailsNode,
  telemetry: TelemetryNode,
  structuredOutput: StructuredOutputNode,
  budget: BudgetNode,
  evals: EvalsNode,
  reflection: ReflectionNode,
  sandbox: SandboxNode,
} as const;
