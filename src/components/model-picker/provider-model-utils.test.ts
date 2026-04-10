import { describe, expect, it } from 'vitest';
import {
  getDefaultModelId,
  getModelOptions,
  isCustomModelId,
} from './provider-model-utils';

describe('provider-model-utils', () => {
  it('deduplicates static and discovered model IDs', () => {
    expect(
      getModelOptions('openrouter', [
        'openai/gpt-4o',
        'custom/model-a',
        'openai/gpt-4o',
      ]),
    ).toContain('custom/model-a');
    expect(
      getModelOptions('openrouter', ['openai/gpt-4o']).filter(
        (id) => id === 'openai/gpt-4o',
      ),
    ).toHaveLength(1);
  });

  it('prefers the first tool-capable discovered OpenRouter model as the default', () => {
    expect(
      getDefaultModelId(
        'openrouter',
        ['google/lyria-3-pro-preview', 'openai/gpt-4o'],
        {
          'google/lyria-3-pro-preview': {
            id: 'google/lyria-3-pro-preview',
            provider: 'openrouter',
            supportedParameters: ['response_format'],
          },
          'openai/gpt-4o': {
            id: 'openai/gpt-4o',
            provider: 'openrouter',
            supportedParameters: ['tools', 'tool_choice'],
          },
        },
      ),
    ).toBe('openai/gpt-4o');
  });

  it('identifies when a modelId is custom for the current provider list', () => {
    expect(
      isCustomModelId('manual/custom-model', ['openai/gpt-4o']),
    ).toBe(true);
    expect(
      isCustomModelId('openai/gpt-4o', ['openai/gpt-4o']),
    ).toBe(false);
  });
});
