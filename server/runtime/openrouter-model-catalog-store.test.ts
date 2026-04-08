import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { OpenRouterModelCatalogStore } from './openrouter-model-catalog-store';

function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('OpenRouterModelCatalogStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-openrouter-catalog-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty cached data when no file exists and no key is provided', async () => {
    const fetchMock = vi.fn();
    const store = new OpenRouterModelCatalogStore(tmpDir, fetchMock as unknown as typeof fetch);

    await expect(store.loadForClient()).resolves.toEqual({
      models: {},
      userModels: {},
      syncedAt: null,
      userModelsRequireRefresh: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes from OpenRouter and persists the cache file', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const ref = typeof url === 'string' ? url : url.toString();
      if (ref.includes('/models/user')) {
        return jsonResponse({
          data: [{ id: 'openai/gpt-4o' }],
        });
      }

      return jsonResponse({
        data: [
          {
            id: 'openai/gpt-4o',
            name: 'GPT-4o',
            context_length: 128000,
            pricing: { prompt: '0.000005', completion: '0.000015' },
            architecture: { input_modalities: ['text'] },
            top_provider: { max_completion_tokens: 8192 },
            supported_parameters: ['tools', 'reasoning'],
          },
        ],
      });
    });
    const store = new OpenRouterModelCatalogStore(tmpDir, fetchMock as unknown as typeof fetch);

    const result = await store.refresh('key-1');

    expect(result.models['openai/gpt-4o']).toBeDefined();
    expect(result.userModels['openai/gpt-4o']).toBeDefined();
    expect(result.userModelsRequireRefresh).toBe(false);

    const persisted = JSON.parse(await fs.readFile(store.getFilePath(), 'utf-8'));
    expect(persisted.models['openai/gpt-4o']).toBeDefined();
    expect(persisted.userModels['openai/gpt-4o']).toBeDefined();
    expect(typeof persisted.userModelsKeyFingerprint).toBe('string');
  });

  it('keeps full models but masks userModels when the current key changed', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          {
            id: 'openai/gpt-4o',
            context_length: 128000,
            pricing: { prompt: '0.000005', completion: '0.000015' },
            architecture: { input_modalities: ['text'] },
            top_provider: { max_completion_tokens: 8192 },
            supported_parameters: ['tools'],
          },
        ],
      }),
    );
    const store = new OpenRouterModelCatalogStore(tmpDir, fetchMock as unknown as typeof fetch);

    await store.refresh('key-1');
    const result = await store.loadForClient('key-2');

    expect(result.models['openai/gpt-4o']).toBeDefined();
    expect(result.userModels).toEqual({});
    expect(result.userModelsRequireRefresh).toBe(true);
  });

  it('does not overwrite a healthy cache file when refresh fails', async () => {
    const healthyFetch = vi.fn(async (url: string | URL | Request) => {
      const ref = typeof url === 'string' ? url : url.toString();
      if (ref.includes('/models/user')) {
        return jsonResponse({ data: [{ id: 'openai/gpt-4o' }] });
      }

      return jsonResponse({
        data: [
          {
            id: 'openai/gpt-4o',
            context_length: 128000,
            pricing: { prompt: '0.000005', completion: '0.000015' },
            architecture: { input_modalities: ['text'] },
            top_provider: { max_completion_tokens: 8192 },
            supported_parameters: ['tools'],
          },
        ],
      });
    });
    const store = new OpenRouterModelCatalogStore(tmpDir, healthyFetch as unknown as typeof fetch);
    await store.refresh('key-1');

    const before = await fs.readFile(store.getFilePath(), 'utf-8');

    const failingFetch = vi.fn(async () => {
      throw new Error('network down');
    });
    const failingStore = new OpenRouterModelCatalogStore(
      tmpDir,
      failingFetch as unknown as typeof fetch,
    );

    await expect(failingStore.refresh('key-1')).rejects.toThrow(/network down/i);

    const after = await fs.readFile(failingStore.getFilePath(), 'utf-8');
    expect(after).toBe(before);
  });
});
