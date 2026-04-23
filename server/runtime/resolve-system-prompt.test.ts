import { beforeAll, describe, expect, it } from 'vitest';
import {
  resolveOutboundSystemPrompt,
  fillConfirmationPolicyPlaceholders,
} from './resolve-system-prompt';
import type { AgentConfig } from '../../shared/agent-config';
import { DEFAULT_SAFETY_SETTINGS } from '../storage/settings-file-store';
import { initializeToolRegistry, TOOL_MODULES } from '../tools/tool-registry';

beforeAll(async () => {
  await initializeToolRegistry(TOOL_MODULES);
});

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    id: 'agent-1',
    version: 2,
    name: 'test',
    description: '',
    tags: [],
    provider: {
      pluginId: 'openrouter',
      authMethod: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: '',
    } as AgentConfig['provider'],
    modelId: 'test-model',
    modelCapabilities: {},
    thinkingLevel: 'off',
    workspacePath: '',
    systemPrompt: {
      mode: 'auto',
      sections: [
        { key: 'identity', label: 'Identity', content: 'You are SAM.', tokenEstimate: 3 },
        { key: 'skills', label: 'Skills', content: 'Skill list.', tokenEstimate: 3 },
      ],
      assembled: 'You are SAM.\n\nSkill list.',
      userInstructions: '',
    },
    tools: {
      profile: 'full',
      resolvedTools: [],
      enabledGroups: [],
      skills: [],
      plugins: [],
      subAgentSpawning: false,
      maxSubAgents: 0,
    },
    connectors: [],
    agentComm: [],
    memory: null,
    contextEngine: null,
    storage: null,
    showReasoning: false,
    verbose: false,
    sandboxWorkdir: false,
    ...overrides,
  } as AgentConfig;
}

describe('resolveOutboundSystemPrompt', () => {
  it('returns the client sections unchanged when nothing triggers runtime injection', () => {
    const result = resolveOutboundSystemPrompt({
      config: makeConfig({ workspacePath: '/project' }),
      safetySettings: {
        ...DEFAULT_SAFETY_SETTINGS,
        confirmationPolicy: '',
        allowDisableHitl: true,
      },
    });
    expect(result.sections.map((s) => s.key)).toEqual(['identity', 'skills']);
    expect(result.assembled).toBe('You are SAM.\n\nSkill list.');
  });

  it('adds a workspace-runtime section when the prompt lacks "Working directory:"', () => {
    const result = resolveOutboundSystemPrompt({
      config: makeConfig(),
      safetySettings: {
        ...DEFAULT_SAFETY_SETTINGS,
        confirmationPolicy: '',
        allowDisableHitl: true,
      },
      workspaceCwd: '/tmp/cwd',
    });
    const ws = result.sections.find((s) => s.key === 'workspace-runtime');
    expect(ws).toBeDefined();
    expect(ws!.content).toContain('/tmp/cwd');
    expect(result.assembled).toContain('/tmp/cwd');
  });

  it('skips workspace fallback when the prompt already has "Working directory:"', () => {
    const config = makeConfig();
    // Inject a workspace line into the assembled text to simulate a
    // client-built Workspace section.
    config.systemPrompt.assembled = `${config.systemPrompt.assembled}\n\n## Workspace\n\nWorking directory: /original`;
    const result = resolveOutboundSystemPrompt({
      config,
      safetySettings: {
        ...DEFAULT_SAFETY_SETTINGS,
        confirmationPolicy: '',
        allowDisableHitl: true,
      },
      workspaceCwd: '/tmp/cwd',
    });
    expect(result.sections.find((s) => s.key === 'workspace-runtime')).toBeUndefined();
  });

  it('appends the confirmation policy when HITL is required by safety settings', () => {
    const result = resolveOutboundSystemPrompt({
      config: makeConfig({
        tools: {
          profile: 'full',
          resolvedTools: ['read_file', 'exec'],
          enabledGroups: [],
          skills: [],
          plugins: [],
          subAgentSpawning: false,
          maxSubAgents: 0,
        },
      }),
      safetySettings: {
        ...DEFAULT_SAFETY_SETTINGS,
        allowDisableHitl: false,
        confirmationPolicy:
          'Policy: read={{READ_ONLY_TOOLS}} | mutate={{STATE_MUTATING_TOOLS}} | destructive={{DESTRUCTIVE_TOOLS}}',
      },
    });
    const cp = result.sections.find((s) => s.key === 'confirmationPolicy');
    expect(cp).toBeDefined();
    // Placeholders must be substituted with actual tool classes.
    expect(cp!.content).not.toContain('{{READ_ONLY_TOOLS}}');
    expect(cp!.content).not.toContain('{{STATE_MUTATING_TOOLS}}');
    expect(cp!.content).not.toContain('{{DESTRUCTIVE_TOOLS}}');
    expect(cp!.content).toContain('`read_file`');
    expect(cp!.content).toContain('`exec`');
    expect(result.assembled).toContain('Policy: read=');
  });

  it('omits the confirmation policy when allowDisableHitl is true and the tool list is empty', () => {
    const result = resolveOutboundSystemPrompt({
      config: makeConfig(),
      safetySettings: {
        ...DEFAULT_SAFETY_SETTINGS,
        allowDisableHitl: true,
        confirmationPolicy: 'Policy: {{READ_ONLY_TOOLS}}',
      },
    });
    expect(result.sections.find((s) => s.key === 'confirmationPolicy')).toBeUndefined();
  });

  it('persists userInstructions + mode unchanged', () => {
    const config = makeConfig();
    config.systemPrompt.userInstructions = 'User says hi';
    config.systemPrompt.mode = 'append';
    const result = resolveOutboundSystemPrompt({
      config,
      safetySettings: { ...DEFAULT_SAFETY_SETTINGS, allowDisableHitl: true, confirmationPolicy: '' },
    });
    expect(result.userInstructions).toBe('User says hi');
    expect(result.mode).toBe('append');
  });
});

describe('fillConfirmationPolicyPlaceholders', () => {
  it('replaces the three placeholders with the corresponding tool classes', () => {
    const out = fillConfirmationPolicyPlaceholders(
      'R={{READ_ONLY_TOOLS}} M={{STATE_MUTATING_TOOLS}} D={{DESTRUCTIVE_TOOLS}}',
      ['read_file', 'exec', 'apply_patch'],
    );
    // Tools are classified elsewhere; just assert all placeholders are gone.
    expect(out).not.toContain('{{READ_ONLY_TOOLS}}');
    expect(out).not.toContain('{{STATE_MUTATING_TOOLS}}');
    expect(out).not.toContain('{{DESTRUCTIVE_TOOLS}}');
  });

  it('emits "(none enabled)" when a class has no tools', () => {
    const out = fillConfirmationPolicyPlaceholders(
      'R={{READ_ONLY_TOOLS}} M={{STATE_MUTATING_TOOLS}} D={{DESTRUCTIVE_TOOLS}}',
      [],
    );
    expect(out).toMatch(/R=\(none enabled\)/);
    expect(out).toMatch(/M=\(none enabled\)/);
    expect(out).toMatch(/D=\(none enabled\)/);
  });
});
