import { describe, it, expect } from 'vitest';
import { buildSamAgentConfig } from './sam-agent-config';

describe('buildSamAgentConfig', () => {
  it('produces a valid AgentConfig with required fields', () => {
    const config = buildSamAgentConfig({
      modelSelection: {
        provider: { pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' },
        modelId: 'anthropic/claude-sonnet-4-6',
      },
      systemPromptText: 'You are SAMAgent...',
    });
    expect(config.id).toBe('samagent');
    expect(config.modelId).toBe('anthropic/claude-sonnet-4-6');
    expect(config.provider.pluginId).toBe('openrouter');
    expect(config.systemPrompt.assembled).toBe('You are SAMAgent...');
    expect(config.memory).toBeNull();
    expect(config.contextEngine).toBeNull();
    expect(config.storage).toBeNull();
    expect(config.tools).toBeNull();
    expect(config.subAgents).toEqual([]);
  });

  it('uses systemPrompt mode "manual" so the prompt is taken verbatim', () => {
    const config = buildSamAgentConfig({
      modelSelection: { provider: { pluginId: 'anthropic', authMethodId: 'api-key', envVar: 'ANTHROPIC_API_KEY', baseUrl: '' }, modelId: 'claude' },
      systemPromptText: 'X',
    });
    expect(config.systemPrompt.mode).toBe('manual');
    expect(config.systemPrompt.assembled).toBe('X');
  });
});
