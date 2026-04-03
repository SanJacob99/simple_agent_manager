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

  it('fetches OpenRouter models when a new key is provided', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: [
            {
              id: 'xiaomi/mimo-v2-pro',
              context_length: 128000,
              pricing: { prompt: '0.1', completion: '0.2' },
              architecture: { input_modalities: ['text'] },
              top_provider: { max_completion_tokens: 8192 },
              supported_parameters: ['reasoning'],
            },
          ],
        }),
      ) as unknown as typeof fetch,
    );

    await useModelCatalogStore.getState().syncOpenRouterKey('key-1');

    expect(
      useModelCatalogStore.getState().models.openrouter['xiaomi/mimo-v2-pro'],
    ).toBeDefined();
  });

  it('clears stale OpenRouter metadata before refetching when the key changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ data: [] })) as unknown as typeof fetch,
    );

    useModelCatalogStore.setState({
      models: {
        openrouter: {
          stale: { id: 'stale', provider: 'openrouter' },
        },
      },
    } as any);

    await useModelCatalogStore.getState().syncOpenRouterKey('key-2');

    const state = useModelCatalogStore.getState();
    expect(state.lastSyncedKeys.openrouter).toBe('key-2');
    expect(state.models.openrouter.stale).toBeUndefined();
  });

  it('does not refetch when the OpenRouter key is unchanged', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const store = useModelCatalogStore.getState();
    await store.syncOpenRouterKey('same-key');
    await store.syncOpenRouterKey('same-key');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when sync is forced with the same OpenRouter key', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: [] }));

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const store = useModelCatalogStore.getState();
    await store.syncOpenRouterKey('same-key');
    await store.syncOpenRouterKey('same-key', { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
