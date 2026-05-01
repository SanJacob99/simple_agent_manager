import { describe, it, expect } from 'vitest';
import type { AgentConfig, ResolvedSubAgentConfig } from '../../shared/agent-config';
import { buildSyntheticAgentConfig } from './sub-agent-executor';

describe('buildSyntheticAgentConfig', () => {
  const parent: AgentConfig = {
    id: 'parent',
    version: 1,
    name: 'parent',
    description: '',
    tags: [],
    provider: { pluginId: 'parentP', authMethodId: 'k', envVar: '', baseUrl: '' },
    modelId: 'parent/model',
    thinkingLevel: 'low',
    systemPrompt: { mode: 'auto', sections: [], assembled: 'parent prompt', userInstructions: '' },
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
    workspacePath: '/parent',
    exportedAt: 0,
    sourceGraphId: 'g1',
    runTimeoutMs: 60000,
  };

  const sub: ResolvedSubAgentConfig = {
    name: 'researcher',
    description: 'r',
    systemPrompt: 'sub prompt',
    modelId: 'sub/model',
    thinkingLevel: 'medium',
    modelCapabilities: {},
    overridableFields: [],
    workingDirectory: '/parent/subagent/researcher',
    recursiveSubAgentsEnabled: false,
    provider: { pluginId: 'subP', authMethodId: 'k', envVar: '', baseUrl: '' },
    tools: {
      profile: 'minimal',
      resolvedTools: ['ask_user'],
      enabledGroups: [],
      skills: [],
      plugins: [],
      subAgentSpawning: false,
      maxSubAgents: 0,
    },
    skills: [],
    mcps: [],
  };

  it('uses sub provider/model/prompt/workspace', () => {
    const synthetic = buildSyntheticAgentConfig(parent, sub, {
      systemPromptAppend: '',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: undefined,
    });
    expect(synthetic.provider.pluginId).toBe('subP');
    expect(synthetic.modelId).toBe('sub/model');
    expect(synthetic.workspacePath).toBe('/parent/subagent/researcher');
    expect(synthetic.systemPrompt.assembled).toContain('sub prompt');
    expect(synthetic.contextEngine).toBeNull();
    expect(synthetic.crons).toEqual([]);
    expect(synthetic.connectors).toEqual([]);
    expect(synthetic.subAgents).toEqual([]);
  });

  it('appends systemPromptAppend when provided', () => {
    const synthetic = buildSyntheticAgentConfig(parent, sub, {
      systemPromptAppend: 'Extra task instructions.',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: undefined,
    });
    expect(synthetic.systemPrompt.assembled).toContain('sub prompt');
    expect(synthetic.systemPrompt.assembled).toContain('Extra task instructions.');
  });

  it('honors enabledTools override (subset of sub.tools.resolvedTools)', () => {
    const subWithTools = {
      ...sub,
      tools: { ...sub.tools, resolvedTools: ['ask_user', 'web_search', 'exec'] },
    };
    const synthetic = buildSyntheticAgentConfig(parent, subWithTools, {
      systemPromptAppend: '',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: ['ask_user', 'web_search'],
    });
    expect(synthetic.tools?.resolvedTools).toEqual(['ask_user', 'web_search']);
  });

  it('exposes subAgents to the synthetic config when recursiveSubAgentsEnabled is true', () => {
    const recSub = { ...sub, recursiveSubAgentsEnabled: true };
    const parentWithSubs = { ...parent, subAgents: [sub] };
    const synthetic = buildSyntheticAgentConfig(parentWithSubs, recSub, {
      systemPromptAppend: '',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: undefined,
    });
    expect(synthetic.subAgents).toHaveLength(1);
    expect(synthetic.subAgents[0].name).toBe('researcher');
  });

  it('hides subAgents (empty list) when recursiveSubAgentsEnabled is false', () => {
    const parentWithSubs = { ...parent, subAgents: [sub] };
    const synthetic = buildSyntheticAgentConfig(parentWithSubs, sub, {
      systemPromptAppend: '',
      modelIdOverride: undefined,
      thinkingLevelOverride: undefined,
      enabledToolsOverride: undefined,
    });
    expect(synthetic.subAgents).toEqual([]);
  });
});
