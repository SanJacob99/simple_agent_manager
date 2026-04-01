import { describe, expect, it } from 'vitest';
import { resolveAgentConfig } from './graph-to-agent';

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
            provider: 'openrouter',
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
});
