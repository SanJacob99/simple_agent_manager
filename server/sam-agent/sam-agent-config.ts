import type { AgentConfig, ResolvedProviderConfig } from '../../shared/agent-config';

export interface SamAgentModelSelection {
  provider: ResolvedProviderConfig;
  modelId: string;
}

export interface BuildSamAgentConfigParams {
  modelSelection: SamAgentModelSelection;
  systemPromptText: string;
}

export function buildSamAgentConfig(params: BuildSamAgentConfigParams): AgentConfig {
  const { modelSelection, systemPromptText } = params;
  return {
    id: 'samagent',
    version: 1,
    name: 'SAMAgent',
    description: 'In-app assistant for Simple Agent Manager',
    tags: [],
    provider: modelSelection.provider,
    modelId: modelSelection.modelId,
    thinkingLevel: 'off',
    systemPrompt: {
      mode: 'manual',
      sections: [],
      assembled: systemPromptText,
      userInstructions: '',
    },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: null,
    vectorDatabases: [],
    crons: [],
    mcps: [],
    subAgents: [],
    workspacePath: null,
    exportedAt: Date.now(),
    sourceGraphId: 'samagent',
    runTimeoutMs: 5 * 60_000,
  };
}
