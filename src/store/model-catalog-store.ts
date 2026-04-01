import { create } from 'zustand';
import type { DiscoveredModelMetadata } from '../types/model-metadata';

type ProviderModelMap = Record<string, DiscoveredModelMetadata>;

interface ModelCatalogState {
  models: { openrouter: ProviderModelMap };
  loading: { openrouter: boolean };
  errors: { openrouter: string | null };
  lastSyncedKeys: { openrouter?: string };
  syncOpenRouterKey: (apiKey: string | undefined) => Promise<void>;
  getProviderModels: (provider: string) => string[];
  getModelMetadata: (
    provider: string,
    modelId: string,
  ) => DiscoveredModelMetadata | undefined;
  reset: () => void;
}

const INITIAL_STATE = {
  models: { openrouter: {} as ProviderModelMap },
  loading: { openrouter: false },
  errors: { openrouter: null as string | null },
  lastSyncedKeys: {} as { openrouter?: string },
};

function mapOpenRouterModel(entry: any): DiscoveredModelMetadata {
  return {
    id: entry.id,
    provider: 'openrouter',
    reasoningSupported:
      Array.isArray(entry.supported_parameters) &&
      entry.supported_parameters.includes('reasoning'),
    inputModalities: entry.architecture?.input_modalities ?? ['text'],
    contextWindow: entry.context_length,
    maxTokens: entry.top_provider?.max_completion_tokens,
    cost: {
      input: Number(entry.pricing?.prompt ?? 0),
      output: Number(entry.pricing?.completion ?? 0),
      cacheRead: Number(entry.pricing?.cache_read ?? 0),
      cacheWrite: Number(entry.pricing?.cache_write ?? 0),
    },
  };
}

export const useModelCatalogStore = create<ModelCatalogState>((set, get) => ({
  ...INITIAL_STATE,

  async syncOpenRouterKey(apiKey) {
    if (!apiKey) {
      set({
        models: { openrouter: {} },
        loading: { openrouter: false },
        errors: { openrouter: null },
        lastSyncedKeys: {},
      });
      return;
    }

    set({
      models: { openrouter: {} },
      loading: { openrouter: true },
      errors: { openrouter: null },
      lastSyncedKeys: { openrouter: apiKey },
    });

    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`OpenRouter model fetch failed: ${response.status}`);
      }

      const body = await response.json();
      const models = Object.fromEntries(
        (body.data ?? []).map((entry: any) => {
          const model = mapOpenRouterModel(entry);
          return [model.id, model];
        }),
      );

      set({
        models: { openrouter: models },
        loading: { openrouter: false },
        errors: { openrouter: null },
        lastSyncedKeys: { openrouter: apiKey },
      });
    } catch (error) {
      set({
        models: { openrouter: {} },
        loading: { openrouter: false },
        errors: {
          openrouter:
            error instanceof Error ? error.message : 'Unknown OpenRouter error',
        },
        lastSyncedKeys: { openrouter: apiKey },
      });
    }
  },

  getProviderModels(provider) {
    if (provider !== 'openrouter') return [];
    return Object.keys(get().models.openrouter);
  },

  getModelMetadata(provider, modelId) {
    if (provider !== 'openrouter') return undefined;
    return get().models.openrouter[modelId];
  },

  reset() {
    set(INITIAL_STATE);
  },
}));
