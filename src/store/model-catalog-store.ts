import { create } from 'zustand';
import type {
  ProviderCatalogResponse,
  ProviderModelMap,
} from '../../shared/model-catalog';
import type { ProviderCatalogRequest } from '../../shared/plugin-sdk';
import type { DiscoveredModelMetadata } from '../types/model-metadata';

export const DEFAULT_OPENROUTER_REQUEST: ProviderCatalogRequest = {
  pluginId: 'openrouter',
  authMethodId: 'api-key',
  envVar: 'OPENROUTER_API_KEY',
  baseUrl: '',
};

export function buildProviderCatalogKey(
  request: Pick<ProviderCatalogRequest, 'pluginId' | 'baseUrl'>,
): string {
  return `${request.pluginId}::${request.baseUrl || 'default'}`;
}

interface ModelCatalogState {
  models: Record<string, ProviderModelMap>;
  userModels: Record<string, ProviderModelMap>;
  syncedAt: Record<string, string | null>;
  userModelsRequireRefresh: Record<string, boolean>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
  loadCatalog: (request: ProviderCatalogRequest) => Promise<void>;
  refreshCatalog: (request: ProviderCatalogRequest) => Promise<void>;
  clearCatalog: (request: ProviderCatalogRequest) => Promise<void>;
  clearAllCatalogs: () => Promise<void>;
  getProviderModels: (key: string) => ProviderModelMap;
  getModelMetadata: (
    key: string,
    modelId: string,
  ) => DiscoveredModelMetadata | undefined;
  loadOpenRouterCatalog: () => Promise<void>;
  refreshOpenRouterCatalog: () => Promise<void>;
  clearOpenRouterCatalog: () => Promise<void>;
  reset: () => void;
}

const INITIAL_STATE: Pick<
  ModelCatalogState,
  | 'models'
  | 'userModels'
  | 'syncedAt'
  | 'userModelsRequireRefresh'
  | 'loading'
  | 'errors'
> = {
  models: {},
  userModels: {},
  syncedAt: {},
  userModelsRequireRefresh: {},
  loading: {},
  errors: {},
};

function applyCatalogResponse(
  state: ModelCatalogState,
  key: string,
  response: ProviderCatalogResponse,
): Partial<ModelCatalogState> {
  return {
    models: { ...state.models, [key]: response.models },
    userModels: { ...state.userModels, [key]: response.userModels },
    syncedAt: { ...state.syncedAt, [key]: response.syncedAt },
    userModelsRequireRefresh: {
      ...state.userModelsRequireRefresh,
      [key]: response.userModelsRequireRefresh,
    },
    loading: { ...state.loading, [key]: false },
    errors: { ...state.errors, [key]: null },
  };
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') {
      return body.error;
    }
  } catch {
    // Fall back to status-based message below.
  }

  return `Request failed: ${response.status}`;
}

async function postCatalogRequest(
  path: string,
  request?: ProviderCatalogRequest,
): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request ? { request } : {}),
  });
}

export const useModelCatalogStore = create<ModelCatalogState>((set, get) => ({
  ...INITIAL_STATE,

  loadCatalog: async (request) => {
    const key = buildProviderCatalogKey(request);
    set((state) => ({
      loading: { ...state.loading, [key]: true },
      errors: { ...state.errors, [key]: null },
    }));

    try {
      const response = await postCatalogRequest('/api/providers/catalog/load', request);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as ProviderCatalogResponse;
      set((state) => applyCatalogResponse(state, key, data));
    } catch (error) {
      set((state) => ({
        loading: { ...state.loading, [key]: false },
        errors: {
          ...state.errors,
          [key]:
            error instanceof Error
              ? error.message
              : 'Unknown provider catalog error',
        },
      }));
    }
  },

  refreshCatalog: async (request) => {
    const key = buildProviderCatalogKey(request);
    set((state) => ({
      loading: { ...state.loading, [key]: true },
      errors: { ...state.errors, [key]: null },
    }));

    try {
      const response = await postCatalogRequest('/api/providers/catalog/refresh', request);
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const data = (await response.json()) as ProviderCatalogResponse;
      set((state) => applyCatalogResponse(state, key, data));
    } catch (error) {
      set((state) => ({
        loading: { ...state.loading, [key]: false },
        errors: {
          ...state.errors,
          [key]:
            error instanceof Error
              ? error.message
              : 'Unknown provider catalog error',
        },
      }));
    }
  },

  clearCatalog: async (request) => {
    const key = buildProviderCatalogKey(request);
    await postCatalogRequest('/api/providers/catalog/clear', request);

    set((state) => ({
      models: { ...state.models, [key]: {} },
      userModels: { ...state.userModels, [key]: {} },
      syncedAt: { ...state.syncedAt, [key]: null },
      userModelsRequireRefresh: {
        ...state.userModelsRequireRefresh,
        [key]: false,
      },
      loading: { ...state.loading, [key]: false },
      errors: { ...state.errors, [key]: null },
    }));
  },

  clearAllCatalogs: async () => {
    await postCatalogRequest('/api/providers/catalog/clear');
    set({ ...INITIAL_STATE });
  },

  getProviderModels: (key) => get().models[key] ?? {},

  getModelMetadata: (key, modelId) => get().models[key]?.[modelId],

  loadOpenRouterCatalog: async () => get().loadCatalog(DEFAULT_OPENROUTER_REQUEST),

  refreshOpenRouterCatalog: async () =>
    get().refreshCatalog(DEFAULT_OPENROUTER_REQUEST),

  clearOpenRouterCatalog: async () =>
    get().clearCatalog(DEFAULT_OPENROUTER_REQUEST),

  reset: () => {
    set({ ...INITIAL_STATE });
  },
}));
