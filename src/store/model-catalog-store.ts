import { create } from 'zustand';
import type { DiscoveredModelMetadata } from '../types/model-metadata';
import type { OpenRouterCatalogResponse } from '../../shared/model-catalog';

type ProviderModelMap = Record<string, DiscoveredModelMetadata>;

interface ModelCatalogState {
  models: { openrouter: ProviderModelMap };
  userModels: { openrouter: ProviderModelMap };
  syncedAt: { openrouter: string | null };
  userModelsRequireRefresh: { openrouter: boolean };
  loading: { openrouter: boolean };
  errors: { openrouter: string | null };
  loadOpenRouterCatalog: () => Promise<void>;
  refreshOpenRouterCatalog: () => Promise<void>;
  clearOpenRouterCatalog: () => Promise<void>;
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
  syncedAt: { openrouter: null as string | null },
  userModelsRequireRefresh: { openrouter: false },
  loading: { openrouter: false },
  errors: { openrouter: null as string | null },
};

function applyCatalogResponse(
  set: (partial: Partial<ModelCatalogState>) => void,
  response: OpenRouterCatalogResponse,
) {
  set({
    models: { openrouter: response.models as ProviderModelMap },
    userModels: { openrouter: response.userModels as ProviderModelMap },
    syncedAt: { openrouter: response.syncedAt },
    userModelsRequireRefresh: {
      openrouter: response.userModelsRequireRefresh,
    },
    loading: { openrouter: false },
    errors: { openrouter: null },
  });
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') {
      return body.error;
    }
  } catch {
    // Fall back to a generic status-based message.
  }

  return `Request failed: ${response.status}`;
}

export const useModelCatalogStore = create<ModelCatalogState>((set, get) => ({
  ...INITIAL_STATE,

  async loadOpenRouterCatalog() {
    set({
      loading: { openrouter: true },
      errors: { openrouter: null },
    });

    try {
      const response = await fetch('/api/model-catalog/openrouter');
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      applyCatalogResponse(set, await response.json());
    } catch (error) {
      set({
        loading: { openrouter: false },
        errors: {
          openrouter:
            error instanceof Error ? error.message : 'Unknown OpenRouter error',
        },
      });
    }
  },

  async refreshOpenRouterCatalog() {
    set({
      loading: { openrouter: true },
      errors: { openrouter: null },
    });

    try {
      const response = await fetch('/api/model-catalog/openrouter/refresh', {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      applyCatalogResponse(set, await response.json());
    } catch (error) {
      set({
        loading: { openrouter: false },
        errors: {
          openrouter:
            error instanceof Error ? error.message : 'Unknown OpenRouter error',
        },
      });
    }
  },

  async clearOpenRouterCatalog() {
    await fetch('/api/model-catalog/openrouter', {
      method: 'DELETE',
    });

    set({
      models: { openrouter: {} },
      userModels: { openrouter: {} },
      syncedAt: { openrouter: null },
      userModelsRequireRefresh: { openrouter: false },
      loading: { openrouter: false },
      errors: { openrouter: null },
    });
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
