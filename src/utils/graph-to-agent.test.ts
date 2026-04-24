import { describe, expect, it } from 'vitest';
import { resolveAgentConfig, validateAgentRuntimeGraph } from './graph-to-agent';

describe('resolveAgentConfig', () => {
  it('carries per-agent capability overrides into runtime config', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            systemPrompt: 'Test',
            systemPromptMode: 'manual' as const,
            modelId: 'xiaomi/mimo-v2-pro',
            thinkingLevel: 'medium',
            description: '',
            tags: [],
            modelCapabilities: {
              reasoningSupported: false,
              contextWindow: 1234,
            },
          },
        },
      ] as any,
      [],
    );

    expect(config?.modelCapabilities?.reasoningSupported).toBe(false);
    expect(config?.modelCapabilities?.contextWindow).toBe(1234);
  });

  it('resolves a connected storage node into config.storage', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Test',
            systemPromptMode: 'manual' as const,

            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
        {
          id: 'storage-1',
          type: 'storage',
          position: { x: -200, y: 0 },
          data: {
            type: 'storage',
            label: 'Storage',
            backendType: 'filesystem',
            storagePath: '/home/user/.simple-agent-manager/storage',
            sessionRetention: 50,
            memoryEnabled: true,
            dailyMemoryEnabled: true,
            dailyResetEnabled: true,
            dailyResetHour: 4,
            idleResetEnabled: false,
            idleResetMinutes: 60,
            parentForkMaxTokens: 100000,
          },
        },
      ] as any,
      [{ id: 'e1', source: 'storage-1', target: 'agent-1', type: 'data' }] as any,
    );

    expect(config?.storage).not.toBeNull();
    expect(config?.storage?.backendType).toBe('filesystem');
    expect(config?.storage?.storagePath).toBe('/home/user/.simple-agent-manager/storage');
    expect(config?.storage?.sessionRetention).toBe(50);
    expect(config?.storage?.memoryEnabled).toBe(true);
    expect(config?.storage?.dailyResetEnabled).toBe(true);
    expect(config?.storage?.dailyResetHour).toBe(4);
    expect(config?.storage?.idleResetEnabled).toBe(false);
    expect(config?.storage?.idleResetMinutes).toBe(60);
    expect(config?.storage?.parentForkMaxTokens).toBe(100000);
  });

  it('returns storage as null when no storage node is connected', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Test',
            systemPromptMode: 'manual' as const,

            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ] as any,
      [],
    );

    expect(config?.storage).toBeNull();
  });

  it('passes through storage path without modification', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Test',
            systemPromptMode: 'manual' as const,

            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
        {
          id: 'storage-1',
          type: 'storage',
          position: { x: -200, y: 0 },
          data: {
            type: 'storage',
            label: 'Storage',
            backendType: 'filesystem',
            storagePath: '~/.simple-agent-manager/storage',
            sessionRetention: 50,
            memoryEnabled: true,
            dailyMemoryEnabled: true,
            dailyResetEnabled: true,
            dailyResetHour: 4,
            idleResetEnabled: false,
            idleResetMinutes: 60,
            parentForkMaxTokens: 100000,
          },
        },
      ] as any,
      [{ id: 'e1', source: 'storage-1', target: 'agent-1', type: 'data' }] as any,
    );

    // Tilde expansion happens in StorageEngine, not during resolution
    expect(config?.storage?.storagePath).toBe('~/.simple-agent-manager/storage');
  });

  it('treats legacy auto mode as append mode in the resolved system prompt', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Ignored in auto mode',
            systemPromptMode: 'auto',

            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ] as any,
      [],
      { safetyGuardrails: '## Safety\nBe safe.' },
    );

    expect(config?.systemPrompt.mode).toBe('append');
    expect(config?.systemPrompt.assembled).toContain('Be safe.');
    expect(config?.systemPrompt.assembled).toContain('Ignored in auto mode');
    expect(config?.systemPrompt.sections.find(s => s.key === 'safety')).toBeDefined();
  });

  it('resolves append mode with user instructions at the end', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Always be concise.',
            systemPromptMode: 'append',

            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ] as any,
      [],
      { safetyGuardrails: '## Safety\nBe safe.' },
    );

    expect(config?.systemPrompt.mode).toBe('append');
    expect(config?.systemPrompt.assembled).toContain('Be safe.');
    expect(config?.systemPrompt.assembled).toContain('Always be concise.');
    expect(config?.systemPrompt.userInstructions).toBe('Always be concise.');
  });

  it('resolves manual mode with only user text', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Full custom prompt.',
            systemPromptMode: 'manual',

            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ] as any,
      [],
      { safetyGuardrails: '## Safety\nBe safe.' },
    );

    expect(config?.systemPrompt.mode).toBe('manual');
    expect(config?.systemPrompt.assembled).toBe('Full custom prompt.');
    expect(config?.systemPrompt.assembled).not.toContain('Be safe.');
  });

  it('emits bundled skill references with the placeholder path, not inline content', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: '',
            systemPromptMode: 'append' as const,
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
        {
          id: 'tools-1',
          type: 'tools',
          position: { x: -200, y: 0 },
          data: {
            type: 'tools',
            label: 'Tools',
            profile: 'custom',
            enabledTools: ['exec', 'web_search'],
            enabledGroups: [],
            skills: [],
            plugins: [],
            subAgentSpawning: false,
            maxSubAgents: 3,
            toolSettings: {
              exec: { cwd: '', sandboxWorkdir: false, skill: '' },
              codeExecution: { apiKey: '', model: '', skill: '' },
              webSearch: { tavilyApiKey: '', skill: '' },
              image: { openaiApiKey: '', geminiApiKey: '', preferredModel: '', skill: '' },
              canva: { portRangeStart: 5173, portRangeEnd: 5273, skill: '' },
              browser: { userDataDir: '', headless: true, viewportWidth: 1280, viewportHeight: 800, timeoutMs: 30000, autoScreenshot: true, screenshotFormat: 'jpeg', screenshotQuality: 60, skill: '' },
              textToSpeech: { preferredProvider: '', elevenLabsApiKey: '', elevenLabsDefaultVoice: '', elevenLabsDefaultModel: '', openaiVoice: '', openaiModel: '', geminiVoice: '', geminiModel: '', microsoftApiKey: '', microsoftRegion: '', microsoftDefaultVoice: '', minimaxApiKey: '', minimaxGroupId: '', minimaxDefaultVoice: '', minimaxDefaultModel: '', openrouterVoice: '', openrouterModel: '', skill: '' },
              musicGenerate: { preferredProvider: '', geminiModel: '', minimaxModel: '', skill: '' },
            },
          },
        },
      ] as any,
      [{ id: 'e1', source: 'tools-1', target: 'agent-1', type: 'data' }] as any,
    );

    const prompt = config!.systemPrompt.assembled;
    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('### Available');
    expect(prompt).toContain('{SAM_BUNDLED_ROOT}/exec/SKILL.md');
    expect(prompt).toContain('{SAM_BUNDLED_ROOT}/web-search/SKILL.md');
    // Only eligible skills show up
    expect(prompt).not.toContain('/browser/SKILL.md');
    // Content is not inlined
    expect(prompt).not.toContain('Prefer `read_file`, `edit_file`');
    // AgentConfig.tools.skills does not carry bundled refs
    expect(config!.tools!.skills).toEqual([]);
  });

  it('falls back to an inline block when a tool has an author override', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: '',
            systemPromptMode: 'append' as const,
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
        {
          id: 'tools-1',
          type: 'tools',
          position: { x: -200, y: 0 },
          data: {
            type: 'tools',
            label: 'Tools',
            profile: 'custom',
            enabledTools: ['exec'],
            enabledGroups: [],
            skills: [],
            plugins: [],
            subAgentSpawning: false,
            maxSubAgents: 3,
            toolSettings: {
              exec: { cwd: '', sandboxWorkdir: false, skill: 'Run only make targets.' },
              codeExecution: { apiKey: '', model: '', skill: '' },
              webSearch: { tavilyApiKey: '', skill: '' },
              image: { openaiApiKey: '', geminiApiKey: '', preferredModel: '', skill: '' },
              canva: { portRangeStart: 5173, portRangeEnd: 5273, skill: '' },
              browser: { userDataDir: '', headless: true, viewportWidth: 1280, viewportHeight: 800, timeoutMs: 30000, autoScreenshot: true, screenshotFormat: 'jpeg', screenshotQuality: 60, skill: '' },
              textToSpeech: { preferredProvider: '', elevenLabsApiKey: '', elevenLabsDefaultVoice: '', elevenLabsDefaultModel: '', openaiVoice: '', openaiModel: '', geminiVoice: '', geminiModel: '', microsoftApiKey: '', microsoftRegion: '', microsoftDefaultVoice: '', minimaxApiKey: '', minimaxGroupId: '', minimaxDefaultVoice: '', minimaxDefaultModel: '', openrouterVoice: '', openrouterModel: '', skill: '' },
              musicGenerate: { preferredProvider: '', geminiModel: '', minimaxModel: '', skill: '' },
            },
          },
        },
      ] as any,
      [{ id: 'e1', source: 'tools-1', target: 'agent-1', type: 'data' }] as any,
    );

    const prompt = config!.systemPrompt.assembled;
    // The override is inlined under its own heading
    expect(prompt).toContain('exec tool guidance (inline override)');
    expect(prompt).toContain('Run only make targets.');
    // Bundled exec reference is suppressed because it's been overridden
    expect(prompt).not.toContain('{SAM_BUNDLED_ROOT}/exec/SKILL.md');
  });
});

describe('provider node resolution', () => {
  const baseAgent = {
    id: 'agent-1',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      type: 'agent' as const,
      name: 'Test',
      nameConfirmed: true,
      systemPrompt: 'hello',
      systemPromptMode: 'append' as const,
      modelId: 'anthropic/claude-sonnet-4-20250514',
      thinkingLevel: 'off' as const,
      description: '',
      tags: [],
      modelCapabilities: {},
      showReasoning: false,
      verbose: false,
    },
  };

  const providerNode = {
    id: 'provider-1',
    type: 'provider',
    position: { x: 0, y: 0 },
    data: {
      type: 'provider' as const,
      label: 'Provider',
      pluginId: 'openrouter',
      authMethodId: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: '',
    },
  };

  const providerEdge = {
    id: 'e1',
    source: 'provider-1',
    target: 'agent-1',
    type: 'data',
  };

  it('resolves ResolvedProviderConfig from connected provider node', () => {
    const result = resolveAgentConfig(
      'agent-1',
      [baseAgent as any, providerNode as any],
      [providerEdge as any],
    );
    expect(result).not.toBeNull();
    expect(result!.provider).toEqual({
      pluginId: 'openrouter',
      authMethodId: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: '',
    });
  });

  it('returns config with empty provider when no provider node connected', () => {
    const result = resolveAgentConfig(
      'agent-1',
      [baseAgent as any],
      [],
    );
    expect(result).not.toBeNull();
    expect(result!.provider).toEqual({
      pluginId: '',
      authMethodId: '',
      envVar: '',
      baseUrl: '',
    });
  });
});

describe('validateAgentRuntimeGraph', () => {
  const baseAgent = {
    id: 'agent-1',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: { type: 'agent' as const, name: 'Test', nameConfirmed: true, systemPrompt: '', systemPromptMode: 'append' as const, modelId: 'test', thinkingLevel: 'off' as const, description: '', tags: [], modelCapabilities: {}, showReasoning: false, verbose: false },
  };
  const providerNode = {
    id: 'p1', type: 'provider', position: { x: 0, y: 0 },
    data: { type: 'provider' as const, label: 'P', pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'KEY', baseUrl: '' },
  };
  const edge = { id: 'e1', source: 'p1', target: 'agent-1', type: 'data' };

  it('returns missing_provider when no provider connected', () => {
    const errors = validateAgentRuntimeGraph('agent-1', [baseAgent as any], []);
    expect(errors).toEqual([{ code: 'missing_provider', message: expect.any(String) }]);
  });

  it('returns empty array when one provider connected', () => {
    const errors = validateAgentRuntimeGraph('agent-1', [baseAgent as any, providerNode as any], [edge as any]);
    expect(errors).toEqual([]);
  });

  it('returns duplicate_provider when two providers connected', () => {
    const p2 = { ...providerNode, id: 'p2', data: { ...providerNode.data } };
    const e2 = { id: 'e2', source: 'p2', target: 'agent-1', type: 'data' };
    const errors = validateAgentRuntimeGraph('agent-1', [baseAgent as any, providerNode as any, p2 as any], [edge as any, e2 as any]);
    expect(errors).toEqual([{ code: 'duplicate_provider', message: expect.any(String) }]);
  });

  it('returns empty_plugin_id when pluginId is empty', () => {
    const emptyPlugin = { ...providerNode, data: { ...providerNode.data, pluginId: '' } };
    const errors = validateAgentRuntimeGraph('agent-1', [baseAgent as any, emptyPlugin as any], [edge as any]);
    expect(errors).toEqual([{ code: 'empty_plugin_id', message: expect.any(String) }]);
  });
});
