import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from './settings-store';
import { DEFAULT_AGENT_DEFAULTS, DEFAULT_STORAGE_DEFAULTS } from './types';

// Mock fetch for server-backed persistence
const savedPayloads: unknown[] = [];

beforeEach(() => {
  savedPayloads.length = 0;

  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url.toString();

    if (urlStr === '/api/settings' && (!init || init.method === undefined || init.method === 'GET')) {
      return new Response(JSON.stringify({
        apiKeys: {},
        agentDefaults: DEFAULT_AGENT_DEFAULTS,
        storageDefaults: DEFAULT_STORAGE_DEFAULTS,
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
    storageDefaults: DEFAULT_STORAGE_DEFAULTS,
    loaded: false,
  });
});

describe('settings store', () => {
  it('persists agent defaults alongside api keys via server API', () => {
    useSettingsStore.getState().setApiKey('openrouter', 'key-1');
    useSettingsStore.getState().setAgentDefaults({
      provider: 'openai',
      modelId: 'gpt-4o',
      thinkingLevel: 'high',
      systemPromptMode: 'append',
      systemPrompt: 'Be concise.',
      safetyGuardrails: 'Test guardrails.',
    });

    // Two PUT calls: one for setApiKey, one for setAgentDefaults
    expect(savedPayloads.length).toBe(2);

    const lastSaved = savedPayloads[1] as {
      apiKeys: Record<string, string>;
      agentDefaults: Record<string, string>;
    };
    expect(lastSaved.apiKeys.openrouter).toBe('key-1');
    expect(lastSaved.agentDefaults.provider).toBe('openai');
    expect(lastSaved.agentDefaults.systemPrompt).toBe('Be concise.');
    expect(lastSaved.agentDefaults.safetyGuardrails).toBe('Test guardrails.');
  });

  it('resets settings back to defaults', () => {
    useSettingsStore.setState({
      apiKeys: { openrouter: 'key-1' },
      agentDefaults: {
        provider: 'openai',
        modelId: 'gpt-4o',
        thinkingLevel: 'high',
        systemPromptMode: 'append',
        systemPrompt: 'Be concise.',
        safetyGuardrails: 'Test guardrails.',
      },
    });

    useSettingsStore.getState().resetSettings();

    expect(useSettingsStore.getState().apiKeys).toEqual({});
    expect(useSettingsStore.getState().agentDefaults).toEqual(
      DEFAULT_AGENT_DEFAULTS,
    );
  });

  it('loads settings from server', async () => {
    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({
        apiKeys: { anthropic: 'loaded-key' },
        agentDefaults: { ...DEFAULT_AGENT_DEFAULTS, provider: 'anthropic' },
        storageDefaults: DEFAULT_STORAGE_DEFAULTS,
      }), { status: 200 });
    }) as typeof fetch;

    await useSettingsStore.getState().loadFromServer();

    expect(useSettingsStore.getState().loaded).toBe(true);
    expect(useSettingsStore.getState().apiKeys.anthropic).toBe('loaded-key');
    expect(useSettingsStore.getState().agentDefaults.provider).toBe('anthropic');
  });
});
