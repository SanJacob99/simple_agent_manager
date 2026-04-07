import { beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from './settings-store';
import { DEFAULT_AGENT_DEFAULTS } from './types';

describe('settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      apiKeys: {},
      agentDefaults: DEFAULT_AGENT_DEFAULTS,
    });
  });

  it('persists agent defaults alongside api keys', () => {
    useSettingsStore.getState().setApiKey('openrouter', 'key-1');
    useSettingsStore.getState().setAgentDefaults({
      provider: 'openai',
      modelId: 'gpt-4o',
      thinkingLevel: 'high',
      systemPromptMode: 'append',
      systemPrompt: 'Be concise.',
      safetyGuardrails: 'Test guardrails.',
    });

    const stored = JSON.parse(
      localStorage.getItem('agent-manager-settings') ?? '{}',
    );

    expect(stored.apiKeys.openrouter).toBe('key-1');
    expect(stored.agentDefaults.provider).toBe('openai');
    expect(stored.agentDefaults.systemPrompt).toBe('Be concise.');
    expect(stored.agentDefaults.safetyGuardrails).toBe('Test guardrails.');
  });

  it('resets settings back to api-key empty state and default agent defaults', () => {
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
});
