import { create } from 'zustand';
import type { DiscoveredModelMetadata } from '../types/model-metadata';

type ProviderModelMap = Record<string, DiscoveredModelMetadata>;
interface SyncOptions {
  force?: boolean;
}

interface ModelCatalogState {
  models: { openrouter: ProviderModelMap };
  userModels: { openrouter: ProviderModelMap };
  loading: { openrouter: boolean };
  errors: { openrouter: string | null };
  lastSyncedKeys: { openrouter?: string };
  syncOpenRouterKey: (
    apiKey: string | undefined,
    options?: SyncOptions,
  ) => Promise<void>;
  getProviderModels: (provider: string) => string[];
  getModelMetadata: (
    provider: string,
    modelId: string,
  ) => DiscoveredModelMetadata | undefined;
  reset: () => void;
}

const INITIAL_STATE = {
  models: { openrouter: {} as ProviderModelMap },
  userModels: { openrouter: {} as ProviderModelMap },
  loading: { openrouter: false },
  errors: { openrouter: null as string | null },
  lastSyncedKeys: {} as { openrouter?: string },
};

function mapOpenRouterModel(entry: any): DiscoveredModelMetadata {
  return {
    id: entry.id,
    provider: 'openrouter',
    name: entry.name,
    description: entry.description,
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
    outputModalities: entry.architecture?.output_modalities ?? ['text'],
    tokenizer: entry.architecture?.tokenizer ?? undefined,
    supportedParameters: Array.isArray(entry.supported_parameters)
      ? entry.supported_parameters
      : undefined,
    topProvider: entry.top_provider
      ? {
          contextLength: entry.top_provider.context_length,
          maxCompletionTokens: entry.top_provider.max_completion_tokens,
          isModerated: entry.top_provider.is_moderated,
        }
      : undefined,
    raw: entry,
  };
}

export const useModelCatalogStore = create<ModelCatalogState>((set, get) => ({
  ...INITIAL_STATE,

  async syncOpenRouterKey(apiKey, options = {}) {
    if (!apiKey) {
      set({
        models: { openrouter: {} },
        userModels: { openrouter: {} },
        loading: { openrouter: false },
        errors: { openrouter: null },
        lastSyncedKeys: {},
      });
      return;
    }

    if (!options.force && get().lastSyncedKeys.openrouter === apiKey) {
      return;
    }

    set({
      models: { openrouter: {} },
      userModels: { openrouter: {} },
      loading: { openrouter: true },
      errors: { openrouter: null },
      lastSyncedKeys: { openrouter: apiKey },
    });

    try {
      const [fullResponse, userResponse] = await Promise.all([
        fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
        fetch('https://openrouter.ai/api/v1/models/user', {
          headers: { Authorization: `Bearer ${apiKey}` },
        }),
      ]);

      if (!fullResponse.ok) {
        throw new Error(`OpenRouter model fetch failed: ${fullResponse.status}`);
      }

      const fullBody = await fullResponse.json();
      const models = Object.fromEntries(
        (fullBody.data ?? []).map((entry: any) => {
          const model = mapOpenRouterModel(entry);
          return [model.id, model];
        }),
      );

      let userModels: ProviderModelMap = {};
      if (userResponse.ok) {
        const userBody = await userResponse.json();
        userModels = Object.fromEntries(
          (userBody.data ?? []).map((entry: any) => {
            const fullModel = models[entry.id];
            const model = fullModel ?? mapOpenRouterModel(entry);
            return [model.id, model];
          }),
        );
      }

      set({
        models: { openrouter: models },
        userModels: { openrouter: userModels },
        loading: { openrouter: false },
        errors: { openrouter: null },
        lastSyncedKeys: { openrouter: apiKey },
      });
    } catch (error) {
      set({
        models: { openrouter: {} },
        userModels: { openrouter: {} },
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
