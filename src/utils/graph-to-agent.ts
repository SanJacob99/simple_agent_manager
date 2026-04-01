import type { AppNode, AgentNodeData } from '../types/nodes';
import type { Edge } from '@xyflow/react';

export interface ResolvedAgentConfig {
  agentNode: AppNode & { data: AgentNodeData };
  connectedNodes: AppNode[];
  systemPrompt: string;
  provider: string;
  modelId: string;
  thinkingLevel: string;
  tools: string[];
  skills: string[];
  memoryConfig: { maxMessages: number; persistent: boolean } | null;
  contextConfig: { strategy: string; maxTokens: number } | null;
}

export function resolveAgentConfig(
  agentNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
): ResolvedAgentConfig | null {
  const agentNode = nodes.find(
    (n) => n.id === agentNodeId && n.data.type === 'agent',
  );
  if (!agentNode || agentNode.data.type !== 'agent') return null;

  const data = agentNode.data;

  // Find all nodes connected to this agent
  const connectedEdges = edges.filter((e) => e.target === agentNodeId);
  const connectedNodes = connectedEdges
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is AppNode => n !== undefined);

  // Collect tools from connected ToolsNode(s)
  const tools = connectedNodes
    .filter((n) => n.data.type === 'tools')
    .flatMap((n) => (n.data.type === 'tools' ? n.data.enabledTools : []));

  // Collect skills
  const skills = connectedNodes
    .filter((n) => n.data.type === 'skills')
    .flatMap((n) => (n.data.type === 'skills' ? n.data.enabledSkills : []));

  // Memory config (take first connected memory node)
  const memoryNode = connectedNodes.find((n) => n.data.type === 'memory');
  const memoryConfig = memoryNode && memoryNode.data.type === 'memory'
    ? { maxMessages: memoryNode.data.maxMessages, persistent: memoryNode.data.persistAcrossSessions }
    : null;

  // Context config
  const contextNode = connectedNodes.find((n) => n.data.type === 'contextEngine');
  const contextConfig = contextNode && contextNode.data.type === 'contextEngine'
    ? { strategy: contextNode.data.strategy, maxTokens: contextNode.data.maxTokens }
    : null;

  // Build augmented system prompt from skills
  let systemPrompt = data.systemPrompt;
  if (skills.length > 0) {
    systemPrompt += `\n\nYou have the following skills: ${skills.join(', ')}.`;
  }

  return {
    agentNode: agentNode as AppNode & { data: AgentNodeData },
    connectedNodes,
    systemPrompt,
    provider: data.provider,
    modelId: data.modelId,
    thinkingLevel: data.thinkingLevel,
    tools,
    skills,
    memoryConfig,
    contextConfig,
  };
}
