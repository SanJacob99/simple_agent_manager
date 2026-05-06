import type { AgentConfig, ResolvedProviderConfig } from '../../shared/agent-config';

export interface SamAgentModelSelection {
  provider: ResolvedProviderConfig;
  modelId: string;
  /**
   * Reasoning effort. Optional for backwards compatibility with older clients;
   * defaults to 'high' so reasoning-required models (e.g. Gemini 3.1 Pro) work
   * out of the box. SAMAgent is intentionally an always-on assistant — running
   * at max thought is the desirable default.
   */
  thinkingLevel?: string;
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
    thinkingLevel: modelSelection.thinkingLevel ?? 'high',
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
