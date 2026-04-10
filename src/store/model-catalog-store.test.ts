import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelCatalogStore } from './model-catalog-store';

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

  it('loads cached OpenRouter catalog data from the backend', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        expect(typeof url === 'string' ? url : url.toString()).toBe(
          '/api/model-catalog/openrouter',
        );

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

    await useModelCatalogStore.getState().loadOpenRouterCatalog();

    expect(
      useModelCatalogStore.getState().models.openrouter['xiaomi/mimo-v2-pro'],
    ).toBeDefined();
    expect(useModelCatalogStore.getState().syncedAt.openrouter).toBe(
      '2026-04-08T14:00:00.000Z',
    );
  });

  it('refreshes the OpenRouter catalog through the backend refresh endpoint', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const ref = typeof url === 'string' ? url : url.toString();
      expect(ref).toBe('/api/model-catalog/openrouter/refresh');
      expect(init?.method).toBe('POST');

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

    await useModelCatalogStore.getState().refreshOpenRouterCatalog();

    expect(useModelCatalogStore.getState().models.openrouter['openai/gpt-4o']).toBeDefined();
    expect(useModelCatalogStore.getState().userModels.openrouter['openai/gpt-4o']).toBeDefined();
    expect(useModelCatalogStore.getState().syncedAt.openrouter).toBe(
      '2026-04-08T15:00:00.000Z',
    );
  });

  it('clears persisted catalog state through the backend delete endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(typeof url === 'string' ? url : url.toString()).toBe(
          '/api/model-catalog/openrouter',
        );
        expect(init?.method).toBe('DELETE');
        return jsonResponse({ ok: true });
      }) as unknown as typeof fetch,
    );

    useModelCatalogStore.setState({
      models: { openrouter: { stale: { id: 'stale', provider: 'openrouter' } } },
      userModels: { openrouter: { stale: { id: 'stale', provider: 'openrouter' } } },
      syncedAt: { openrouter: '2026-04-08T15:00:00.000Z' },
      userModelsRequireRefresh: { openrouter: true },
      loading: { openrouter: false },
      errors: { openrouter: null },
    } as any);

    await useModelCatalogStore.getState().clearOpenRouterCatalog();

    const state = useModelCatalogStore.getState();
    expect(state.models.openrouter).toEqual({});
    expect(state.userModels.openrouter).toEqual({});
    expect(state.syncedAt.openrouter).toBeNull();
    expect(state.userModelsRequireRefresh.openrouter).toBe(false);
  });

  it('keeps full models visible when userModelsRequireRefresh is true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          models: {
            'openai/gpt-4o': { id: 'openai/gpt-4o', provider: 'openrouter' },
          },
          userModels: {},
          syncedAt: '2026-04-08T16:00:00.000Z',
          userModelsRequireRefresh: true,
        })) as unknown as typeof fetch,
    );

    await useModelCatalogStore.getState().loadOpenRouterCatalog();

    const state = useModelCatalogStore.getState();
    expect(state.models.openrouter['openai/gpt-4o']).toBeDefined();
    expect(state.userModels.openrouter).toEqual({});
    expect(state.userModelsRequireRefresh.openrouter).toBe(true);
  });
});
