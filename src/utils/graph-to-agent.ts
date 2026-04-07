import type { AppNode } from '../types/nodes';
import type { Edge } from '@xyflow/react';
import type { AgentConfig } from '../../shared/agent-config';
import type { SystemPromptMode } from '../../shared/agent-config';
import { resolveToolNames } from '../../shared/resolve-tool-names';
import { buildSystemPrompt } from '../../shared/system-prompt-builder';

export function resolveAgentConfig(
  agentNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
  options: { safetyGuardrails?: string } = {},
): AgentConfig | null {
  const agentNode = nodes.find(
    (n) => n.id === agentNodeId && n.data.type === 'agent',
  );
  if (!agentNode || agentNode.data.type !== 'agent') return null;

  const data = agentNode.data;

  // Find all nodes connected to this agent (peripheral -> agent edges)
  const connectedEdges = edges.filter((e) => e.target === agentNodeId);
  const connectedNodes = connectedEdges
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is AppNode => n !== undefined);

  // --- Memory ---
  const memoryNode = connectedNodes.find((n) => n.data.type === 'memory');
  const memory = memoryNode && memoryNode.data.type === 'memory'
    ? {
        backend: memoryNode.data.backend,
        maxSessionMessages: memoryNode.data.maxSessionMessages,
        persistAcrossSessions: memoryNode.data.persistAcrossSessions,
        compactionEnabled: memoryNode.data.compactionEnabled,
        compactionThreshold: memoryNode.data.compactionThreshold,
        compactionStrategy: memoryNode.data.compactionStrategy,
        exposeMemorySearch: memoryNode.data.exposeMemorySearch,
        exposeMemoryGet: memoryNode.data.exposeMemoryGet,
        exposeMemorySave: memoryNode.data.exposeMemorySave,
        searchMode: memoryNode.data.searchMode,
        externalEndpoint: memoryNode.data.externalEndpoint,
        externalApiKey: memoryNode.data.externalApiKey,
      }
    : null;

  // --- Tools ---
  const toolsNode = connectedNodes.find((n) => n.data.type === 'tools');
  const skillsNodes = connectedNodes.filter((n) => n.data.type === 'skills');

  // Collect skills from SkillsNode(s) + ToolsNode skills
  const allSkills = toolsNode && toolsNode.data.type === 'tools'
    ? [...toolsNode.data.skills]
    : [];

  // Collect skills from standalone SkillsNode as system-prompt injections
  for (const sn of skillsNodes) {
    if (sn.data.type === 'skills') {
      for (const skillName of sn.data.enabledSkills) {
        allSkills.push({
          id: skillName,
          name: skillName,
          content: `You have the skill: ${skillName}`,
          injectAs: 'system-prompt' as const,
        });
      }
    }
  }

  const toolsConfig = toolsNode && toolsNode.data.type === 'tools'
    ? {
        profile: toolsNode.data.profile,
        resolvedTools: resolveToolNames({
          profile: toolsNode.data.profile,
          resolvedTools: toolsNode.data.enabledTools,
          enabledGroups: toolsNode.data.enabledGroups,
          skills: allSkills,
          plugins: toolsNode.data.plugins,
          subAgentSpawning: toolsNode.data.subAgentSpawning,
          maxSubAgents: toolsNode.data.maxSubAgents,
        }),
        enabledGroups: toolsNode.data.enabledGroups,
        skills: allSkills,
        plugins: toolsNode.data.plugins,
        subAgentSpawning: toolsNode.data.subAgentSpawning,
        maxSubAgents: toolsNode.data.maxSubAgents,
      }
    : null;

  // --- Context Engine ---
  const contextNode = connectedNodes.find((n) => n.data.type === 'contextEngine');
  const contextEngine = contextNode && contextNode.data.type === 'contextEngine'
    ? {
        tokenBudget: contextNode.data.tokenBudget,
        reservedForResponse: contextNode.data.reservedForResponse,
        ownsCompaction: contextNode.data.ownsCompaction,
        compactionStrategy: contextNode.data.compactionStrategy,
        compactionTrigger: contextNode.data.compactionTrigger,
        compactionThreshold: contextNode.data.compactionThreshold,
        autoFlushBeforeCompact: contextNode.data.autoFlushBeforeCompact,
        ragEnabled: contextNode.data.ragEnabled,
        ragTopK: contextNode.data.ragTopK,
        ragMinScore: contextNode.data.ragMinScore,
      }
    : null;

  // --- Connectors ---
  const connectors = connectedNodes
    .filter((n) => n.data.type === 'connectors')
    .map((n) => {
      if (n.data.type !== 'connectors') throw new Error('unreachable');
      return {
        label: n.data.label,
        connectorType: n.data.connectorType,
        config: n.data.config,
      };
    });

  // --- Agent Communication ---
  const agentComm = connectedNodes
    .filter((n) => n.data.type === 'agentComm')
    .map((n) => {
      if (n.data.type !== 'agentComm') throw new Error('unreachable');
      return {
        label: n.data.label,
        targetAgentNodeId: n.data.targetAgentNodeId,
        protocol: n.data.protocol,
      };
    });

  // --- Storage ---
  const storageNode = connectedNodes.find((n) => n.data.type === 'storage');
  const storage = storageNode && storageNode.data.type === 'storage'
    ? {
        label: storageNode.data.label,
        backendType: storageNode.data.backendType,
        storagePath: storageNode.data.storagePath,
        sessionRetention: storageNode.data.sessionRetention,
        memoryEnabled: storageNode.data.memoryEnabled,
        dailyMemoryEnabled: storageNode.data.dailyMemoryEnabled,
      }
    : null;

  // --- Vector Databases ---
  const vectorDatabases = connectedNodes
    .filter((n) => n.data.type === 'vectorDatabase')
    .map((n) => {
      if (n.data.type !== 'vectorDatabase') throw new Error('unreachable');
      return {
        label: n.data.label,
        provider: n.data.provider,
        collectionName: n.data.collectionName,
        connectionString: n.data.connectionString,
      };
    });

  // --- Build structured system prompt ---
  const agentMode = (data as any).systemPromptMode as SystemPromptMode | undefined;
  const mode: SystemPromptMode = agentMode === 'manual' ? 'manual' : 'append';

  const toolsSummary = toolsConfig
    ? toolsConfig.resolvedTools.join(', ')
    : null;

  const skillsSummary = allSkills.length > 0
    ? allSkills.map(s => `- ${s.name}`).join('\n')
    : null;

  const bootstrapMaxChars = contextNode && contextNode.data.type === 'contextEngine'
    ? ((contextNode.data as any).bootstrapMaxChars ?? 20000)
    : 20000;
  const bootstrapTotalMaxChars = contextNode && contextNode.data.type === 'contextEngine'
    ? ((contextNode.data as any).bootstrapTotalMaxChars ?? 150000)
    : 150000;

  const workspacePath = storage ? storage.storagePath : null;

  const systemPrompt = buildSystemPrompt({
    mode,
    userInstructions: data.systemPrompt,
    safetyGuardrails: options.safetyGuardrails ?? '',
    toolsSummary,
    skillsSummary,
    workspacePath,
    bootstrapFiles: null,
    bootstrapMaxChars,
    bootstrapTotalMaxChars,
    timezone: null,
    runtimeMeta: {
      host: 'simple-agent-manager',
      os: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
      model: data.modelId,
      thinkingLevel: data.thinkingLevel,
    },
  });

  return {
    id: agentNodeId,
    version: 2,
    name: data.name,
    description: data.description,
    tags: data.tags,
    provider: data.provider,
    modelId: data.modelId,
    thinkingLevel: data.thinkingLevel,
    systemPrompt,
    modelCapabilities: data.modelCapabilities ?? {},
    memory,
    tools: toolsConfig,
    contextEngine,
    connectors,
    agentComm,
    storage,
    vectorDatabases,
    exportedAt: Date.now(),
    sourceGraphId: agentNodeId,
    runTimeoutMs: 172800000,
    showReasoning: data.showReasoning ?? false,
    verbose: data.verbose ?? false,
  };
}
