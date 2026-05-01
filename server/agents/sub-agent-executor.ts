import type { AgentConfig, ResolvedSubAgentConfig, ResolvedSystemPrompt } from '../../shared/agent-config';

export interface SubAgentSpawnOverrides {
  systemPromptAppend: string;
  modelIdOverride: string | undefined;
  thinkingLevelOverride: string | undefined;
  enabledToolsOverride: string[] | undefined;
}

/**
 * Build a runtime-ready AgentConfig for a single sub-agent spawn. Does not
 * mutate the parent or sub config.
 *
 * Inheritance for fields NOT present on ResolvedSubAgentConfig (memory,
 * connectors, agentComm, vectorDatabases, crons): always cleared on the
 * synthetic config — sub-agents do not own these resources.
 *
 * Inheritance for fields present on the sub: take the sub's value (already
 * resolved to inherit-from-parent at graph-resolution time).
 */
export function buildSyntheticAgentConfig(
  parent: AgentConfig,
  sub: ResolvedSubAgentConfig,
  overrides: SubAgentSpawnOverrides,
): AgentConfig {
  const modelId = overrides.modelIdOverride ?? sub.modelId;
  const thinkingLevel = overrides.thinkingLevelOverride ?? sub.thinkingLevel;

  const baseTools = sub.tools;
  const tools = overrides.enabledToolsOverride
    ? { ...baseTools, resolvedTools: [...overrides.enabledToolsOverride] }
    : baseTools;

  const subPromptText = sub.systemPrompt;
  const appendText = overrides.systemPromptAppend?.trim();
  const assembled = appendText ? `${subPromptText}\n\n${appendText}` : subPromptText;

  const systemPrompt: ResolvedSystemPrompt = {
    mode: 'manual',
    sections: [],
    assembled,
    userInstructions: subPromptText,
  };

  return {
    id: `${parent.id}::sub::${sub.name}`,
    version: parent.version,
    name: `${parent.name}/${sub.name}`,
    description: sub.description,
    tags: [],

    provider: sub.provider,
    modelId,
    thinkingLevel,
    systemPrompt,
    modelCapabilities: sub.modelCapabilities,

    memory: null,
    tools,
    contextEngine: null,             // sub-agents are one-shot; no compaction
    connectors: [],
    agentComm: [],
    storage: parent.storage,         // sub-sessions live under the parent's storage
    vectorDatabases: [],
    crons: [],
    mcps: sub.mcps,
    subAgents: sub.recursiveSubAgentsEnabled ? parent.subAgents : [],

    workspacePath: sub.workingDirectory || parent.workspacePath || null,
    sandboxWorkdir: parent.sandboxWorkdir,
    xaiApiKey: parent.xaiApiKey,
    xaiModel: parent.xaiModel,
    tavilyApiKey: parent.tavilyApiKey,
    openaiApiKey: parent.openaiApiKey,
    geminiApiKey: parent.geminiApiKey,
    imageModel: parent.imageModel,

    exportedAt: parent.exportedAt,
    sourceGraphId: parent.sourceGraphId,
    runTimeoutMs: parent.runTimeoutMs,
    showReasoning: parent.showReasoning,
    verbose: parent.verbose,
  };
}
