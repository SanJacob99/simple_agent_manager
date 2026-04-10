import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPENROUTER_REQUEST,
  buildProviderCatalogKey,
  useModelCatalogStore,
} from './model-catalog-store';

function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('model catalog store', () => {
  beforeEach(() => {
    useModelCatalogStore.getState().reset();
  });

  it('loads cached provider catalog data from the backend', async () => {
    const request = {
      pluginId: 'openrouter',
      authMethodId: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: '',
    };
    const key = buildProviderCatalogKey(request);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(typeof url === 'string' ? url : url.toString()).toBe(
          '/api/providers/catalog/load',
        );
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ request }));

        return jsonResponse({
          models: {
            'xiaomi/mimo-v2-pro': {
              id: 'xiaomi/mimo-v2-pro',
              provider: 'openrouter',
            },
          },
          userModels: {},
          syncedAt: '2026-04-08T14:00:00.000Z',
          userModelsRequireRefresh: false,
        });
      }) as unknown as typeof fetch,
    );

    await useModelCatalogStore.getState().loadCatalog(request);

    expect(
      useModelCatalogStore.getState().models[key]['xiaomi/mimo-v2-pro'],
    ).toBeDefined();
    expect(useModelCatalogStore.getState().syncedAt[key]).toBe(
      '2026-04-08T14:00:00.000Z',
    );
  });

  it('refreshes provider catalog data through the backend refresh endpoint', async () => {
    const request = {
      pluginId: 'openrouter',
      authMethodId: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: '',
    };
    const key = buildProviderCatalogKey(request);
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const ref = typeof url === 'string' ? url : url.toString();
      expect(ref).toBe('/api/providers/catalog/refresh');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBe(JSON.stringify({ request }));

      return jsonResponse({
        models: {
          'openai/gpt-4o': {
            id: 'openai/gpt-4o',
            provider: 'openrouter',
          },
        },
        userModels: {
          'openai/gpt-4o': {
            id: 'openai/gpt-4o',
            provider: 'openrouter',
          },
        },
        syncedAt: '2026-04-08T15:00:00.000Z',
        userModelsRequireRefresh: false,
      });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await useModelCatalogStore.getState().refreshCatalog(request);

    expect(useModelCatalogStore.getState().models[key]['openai/gpt-4o']).toBeDefined();
    expect(useModelCatalogStore.getState().userModels[key]['openai/gpt-4o']).toBeDefined();
    expect(useModelCatalogStore.getState().syncedAt[key]).toBe(
      '2026-04-08T15:00:00.000Z',
    );
  });

  it('clears persisted provider catalog state through the backend clear endpoint', async () => {
    const request = {
      pluginId: 'openrouter',
      authMethodId: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: '',
    };
    const key = buildProviderCatalogKey(request);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(typeof url === 'string' ? url : url.toString()).toBe(
          '/api/providers/catalog/clear',
        );
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ request }));
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch,
    );

    useModelCatalogStore.setState({
      models: { [key]: { stale: { id: 'stale', provider: 'openrouter' } } },
      userModels: { [key]: { stale: { id: 'stale', provider: 'openrouter' } } },
      syncedAt: { [key]: '2026-04-08T15:00:00.000Z' },
      userModelsRequireRefresh: { [key]: true },
      loading: { [key]: false },
      errors: { [key]: null },
    } as any);

    await useModelCatalogStore.getState().clearCatalog(request);

    const state = useModelCatalogStore.getState();
    expect(state.models[key]).toEqual({});
    expect(state.userModels[key]).toEqual({});
    expect(state.syncedAt[key]).toBeNull();
    expect(state.userModelsRequireRefresh[key]).toBe(false);
  });

  it('supports the legacy OpenRouter wrapper through the provider catalog API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(typeof url === 'string' ? url : url.toString()).toBe(
          '/api/providers/catalog/load',
        );
        expect(init?.method).toBe('POST');
        expect(init?.body).toBe(JSON.stringify({ request: DEFAULT_OPENROUTER_REQUEST }));
        return jsonResponse({
          models: {
            'openai/gpt-4o': { id: 'openai/gpt-4o', provider: 'openrouter' },
          },
          userModels: {},
          syncedAt: '2026-04-08T16:00:00.000Z',
          userModelsRequireRefresh: true,
        });
      }) as unknown as typeof fetch,
    );

    await useModelCatalogStore.getState().loadOpenRouterCatalog();

    const state = useModelCatalogStore.getState();
    const key = buildProviderCatalogKey(DEFAULT_OPENROUTER_REQUEST);
    expect(state.models[key]['openai/gpt-4o']).toBeDefined();
    expect(state.userModels[key]).toEqual({});
    expect(state.userModelsRequireRefresh[key]).toBe(true);
  });
});
