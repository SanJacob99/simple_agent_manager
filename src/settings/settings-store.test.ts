import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settings-store';
import {
  DEFAULT_AGENT_DEFAULTS,
  DEFAULT_PROVIDER_DEFAULTS,
  DEFAULT_STORAGE_DEFAULTS,
  DEFAULT_CONTEXT_ENGINE_DEFAULTS,
  DEFAULT_MEMORY_DEFAULTS,
  DEFAULT_CRON_DEFAULTS,
  DEFAULT_SAM_AGENT_DEFAULTS,
} from './types';

const savedPayloads: unknown[] = [];

beforeEach(() => {
  savedPayloads.length = 0;

  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    if (urlStr === '/api/settings' && (!init || init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({
        apiKeys: {},
        agentDefaults: DEFAULT_AGENT_DEFAULTS,
        providerDefaults: DEFAULT_PROVIDER_DEFAULTS,
        storageDefaults: DEFAULT_STORAGE_DEFAULTS,
        contextEngineDefaults: DEFAULT_CONTEXT_ENGINE_DEFAULTS,
        memoryDefaults: DEFAULT_MEMORY_DEFAULTS,
        cronDefaults: DEFAULT_CRON_DEFAULTS,
      }), { status: 200 });
    }

    if (urlStr === '/api/settings' && init?.method === 'PUT') {
      savedPayloads.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  }) as typeof fetch;

  useSettingsStore.setState({
    apiKeys: {},
    agentDefaults: DEFAULT_AGENT_DEFAULTS,
    providerDefaults: DEFAULT_PROVIDER_DEFAULTS,
    storageDefaults: DEFAULT_STORAGE_DEFAULTS,
    contextEngineDefaults: DEFAULT_CONTEXT_ENGINE_DEFAULTS,
    memoryDefaults: DEFAULT_MEMORY_DEFAULTS,
    cronDefaults: DEFAULT_CRON_DEFAULTS,
    samAgentDefaults: DEFAULT_SAM_AGENT_DEFAULTS,
    loaded: false,
  });
});

describe('settings store', () => {
  it('persists agent and provider defaults alongside api keys via server API', () => {
    useSettingsStore.getState().setApiKey('openrouter', 'key-1');
    useSettingsStore.getState().setAgentDefaults({
      modelId: 'gpt-4o',
      thinkingLevel: 'high',
      systemPromptMode: 'append',
      systemPrompt: 'Be concise.',
      safetyGuardrails: 'Test guardrails.',
    });
    useSettingsStore.getState().setProviderDefaults({
      pluginId: 'openrouter',
      authMethodId: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: 'https://proxy.example/v1',
    });

    expect(savedPayloads.length).toBe(3);
    const lastSaved = savedPayloads[2] as Record<string, any>;
    expect(lastSaved.apiKeys.openrouter).toBe('key-1');
    expect(lastSaved.agentDefaults.systemPrompt).toBe('Be concise.');
    expect(lastSaved.providerDefaults.baseUrl).toBe('https://proxy.example/v1');
  });

  it('resets settings back to defaults', () => {
    useSettingsStore.getState().setProviderDefaults({ baseUrl: 'https://proxy.example/v1' });
    useSettingsStore.getState().setContextEngineDefaults({ tokenBudget: 64000 });
    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState().apiKeys).toEqual({});
    expect(useSettingsStore.getState().agentDefaults).toEqual(DEFAULT_AGENT_DEFAULTS);
    expect(useSettingsStore.getState().providerDefaults).toEqual(DEFAULT_PROVIDER_DEFAULTS);
    expect(useSettingsStore.getState().contextEngineDefaults).toEqual(DEFAULT_CONTEXT_ENGINE_DEFAULTS);
  });

  it('loads settings from server', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        apiKeys: { anthropic: 'loaded-key' },
        agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, modelId: 'claude-sonnet-4-20250514' },
        providerDefaults: { ...DEFAULT_PROVIDER_DEFAULTS, pluginId: 'openrouter', baseUrl: 'https://proxy.example/v1' },
        storageDefaults: DEFAULT_STORAGE_DEFAULTS,
        contextEngineDefaults: { ...DEFAULT_CONTEXT_ENGINE_DEFAULTS, tokenBudget: 64000 },
        memoryDefaults: DEFAULT_MEMORY_DEFAULTS,
        cronDefaults: DEFAULT_CRON_DEFAULTS,
      }), { status: 200 });
    }) as typeof fetch;

    await useSettingsStore.getState().loadFromServer();

    expect(useSettingsStore.getState().loaded).toBe(true);
    expect(useSettingsStore.getState().apiKeys.anthropic).toBe('loaded-key');
    expect(useSettingsStore.getState().providerDefaults.baseUrl).toBe('https://proxy.example/v1');
    expect(useSettingsStore.getState().contextEngineDefaults.tokenBudget).toBe(64000);
  });

  it('persists per-node-type defaults', () => {
    useSettingsStore.getState().setProviderDefaults({ baseUrl: 'https://proxy.example/v1' });
    useSettingsStore.getState().setContextEngineDefaults({ tokenBudget: 64000 });
    useSettingsStore.getState().setMemoryDefaults({ maxSessionMessages: 50 });
    useSettingsStore.getState().setCronDefaults({ retentionDays: 14 });

    expect(savedPayloads.length).toBe(4);
    const last = savedPayloads[3] as Record<string, any>;
    expect(last.providerDefaults.baseUrl).toBe('https://proxy.example/v1');
    expect(last.contextEngineDefaults.tokenBudget).toBe(64000);
    expect(last.memoryDefaults.maxSessionMessages).toBe(50);
    expect(last.cronDefaults.retentionDays).toBe(14);
  });

  it('samAgentDefaults defaults to { modelSelection: null }', () => {
    expect(useSettingsStore.getState().samAgentDefaults).toEqual({ modelSelection: null });
  });

  it('setSamAgentDefaults updates modelSelection', () => {
    useSettingsStore.getState().setSamAgentDefaults({
      modelSelection: { provider: { pluginId: 'p', authMethodId: 'a', envVar: 'E', baseUrl: '' }, modelId: 'm' },
    });
    expect(useSettingsStore.getState().samAgentDefaults.modelSelection?.modelId).toBe('m');
  });
});
