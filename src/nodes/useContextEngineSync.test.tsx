import { beforeEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useContextEngineSync } from './useContextEngineSync';
import { useGraphStore } from '../store/graph-store';
import { useModelCatalogStore } from '../store/model-catalog-store';
import type { ContextEngineNodeData } from '../types/nodes';

const contextNodeData: ContextEngineNodeData = {
  type: 'contextEngine',
  label: 'Context',
  tokenBudget: 1000,
  reservedForResponse: 200,
  compactionStrategy: 'summary',
  compactionTrigger: 'auto',
  compactionThreshold: 0.8,
  postCompactionTokenTarget: 500,
  autoFlushBeforeCompact: true,
  ragEnabled: false,
  ragTopK: 5,
  ragMinScore: 0.7,
};

describe('useContextEngineSync', () => {
  beforeEach(() => {
    useGraphStore.setState({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      pendingNameNodeId: null,
    } as any);
    useModelCatalogStore.getState().reset();
  });

  it('reads model metadata from the connected provider catalog', () => {
    useGraphStore.setState({
      nodes: [
        {
          id: 'context-1',
          type: 'contextEngine',
          position: { x: 0, y: 0 },
          data: contextNodeData,
        },
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 200, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Hello',
            systemPromptMode: 'append',
            modelId: 'custom/provider-model',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
            showReasoning: false,
            verbose: false,
          },
        },
        {
          id: 'provider-1',
          type: 'provider',
          position: { x: -200, y: 0 },
          data: {
            type: 'provider',
            label: 'OpenRouter',
            pluginId: 'openrouter',
            authMethodId: 'api-key',
            envVar: 'OPENROUTER_API_KEY',
            baseUrl: '',
          },
        },
      ],
      edges: [
        { id: 'context-edge', source: 'context-1', target: 'agent-1', type: 'data' },
        { id: 'provider-edge', source: 'provider-1', target: 'agent-1', type: 'data' },
      ],
    } as any);

    useModelCatalogStore.setState({
      models: {
        'openrouter::default': {
          'custom/provider-model': {
            id: 'custom/provider-model',
            provider: 'openrouter',
            contextWindow: 32000,
          },
        },
      },
    } as any);

    const { result } = renderHook(() =>
      useContextEngineSync('context-1', contextNodeData),
    );

    expect(result.current.modelContextWindow).toBe(32000);
  });
});
