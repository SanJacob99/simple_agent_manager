import { describe, expect, it } from 'vitest';
import { importGraph } from './export-import';

describe('importGraph', () => {
  it('removes the legacy provider field from imported agent nodes', () => {
    const result = importGraph({
      graph: {
        graph: {
          nodes: [
            {
              id: 'agent-1',
              type: 'agent',
              position: { x: 0, y: 0 },
              data: {
                type: 'agent',
                name: 'Imported Agent',
                nameConfirmed: true,
                systemPrompt: 'Hello',
                systemPromptMode: 'append',
                provider: 'openrouter',
                modelId: 'anthropic/claude-sonnet-4-20250514',
                thinkingLevel: 'off',
                description: '',
                tags: [],
                modelCapabilities: {},
              },
            },
          ],
          edges: [],
        },
      },
    });

    expect(result).not.toBeNull();
    const agent = result!.nodes[0];
    expect(agent.data.type).toBe('agent');
    expect('provider' in agent.data).toBe(false);
  });

  it('preserves provider nodes during import', () => {
    const result = importGraph({
      graph: {
        graph: {
          nodes: [
            {
              id: 'provider-1',
              type: 'provider',
              position: { x: 0, y: 0 },
              data: {
                type: 'provider',
                label: 'OpenRouter',
                pluginId: 'openrouter',
                authMethodId: 'api-key',
                envVar: 'OPENROUTER_API_KEY',
                baseUrl: 'https://openrouter.ai/api/v1',
              },
            },
          ],
          edges: [],
        },
      },
    });

    expect(result).not.toBeNull();
    const provider = result!.nodes[0];
    expect(provider.data.type).toBe('provider');
    if (provider.data.type !== 'provider') {
      throw new Error('unreachable');
    }
    expect(provider.data.pluginId).toBe('openrouter');
    expect(provider.data.baseUrl).toBe('https://openrouter.ai/api/v1');
  });
});
