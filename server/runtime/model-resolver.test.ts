import { describe, expect, it } from 'vitest';
import { resolveRuntimeModel } from './model-resolver';

describe('resolveRuntimeModel', () => {
  it('returns the built-in pi-ai model when the model id is known', () => {
    const model = resolveRuntimeModel({
      provider: {
        pluginId: 'openai',
        authMethodId: 'api-key',
        envVar: '',
        baseUrl: '',
      },
      runtimeProviderId: 'openai',
      modelId: 'gpt-4o',
      modelCapabilities: {},
      getDiscoveredModel: () => undefined,
    });

    expect(model.id).toBe('gpt-4o');
    expect(model.provider).toBe('openai');
  });

  it('builds a runtime model from discovered metadata when the model id is unknown to pi-ai', () => {
    const model = resolveRuntimeModel({
      provider: {
        pluginId: 'openrouter',
        authMethodId: 'api-key',
        envVar: '',
        baseUrl: '',
      },
      runtimeProviderId: 'openrouter',
      modelId: 'xiaomi/mimo-v2-pro',
      modelCapabilities: { contextWindow: 64000 },
      getDiscoveredModel: () => ({
        id: 'xiaomi/mimo-v2-pro',
        provider: 'openrouter',
        reasoningSupported: true,
        inputModalities: ['text'],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      }),
    });

    expect(model.id).toBe('xiaomi/mimo-v2-pro');
    expect(model.contextWindow).toBe(64000);
    expect(model.baseUrl).toContain('openrouter.ai');
  });

  it('falls back to a provider template when no discovered metadata exists', () => {
    const model = resolveRuntimeModel({
      provider: {
        pluginId: 'openrouter',
        authMethodId: 'api-key',
        envVar: '',
        baseUrl: '',
      },
      runtimeProviderId: 'openrouter',
      modelId: 'manual/custom-model',
      modelCapabilities: {},
      getDiscoveredModel: () => undefined,
    });

    expect(model.id).toBe('manual/custom-model');
    expect(model.provider).toBe('openrouter');
  });
});
