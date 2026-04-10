import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { DiscoveredModelMetadata } from '../../shared/agent-config';
import type {
  OpenRouterCatalogResponse,
  ProviderModelMap,
} from '../../shared/model-catalog';

const CATALOG_FILE = 'openrouter-model-catalog.json';

interface PersistedOpenRouterCatalog {
  models: ProviderModelMap;
  userModels: ProviderModelMap;
  syncedAt: string | null;
  userModelsKeyFingerprint: string | null;
}

const EMPTY_RESPONSE: OpenRouterCatalogResponse = {
  models: {},
  userModels: {},
  syncedAt: null,
  userModelsRequireRefresh: false,
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

export class OpenRouterModelCatalogStore {
  private readonly filePath: string;

  constructor(
    dir = process.cwd(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.filePath = path.join(dir, CATALOG_FILE);
  }

  async loadForClient(apiKey?: string): Promise<OpenRouterCatalogResponse> {
    const persisted = await this.readPersisted();
    if (!persisted) {
      if (!apiKey) return { ...EMPTY_RESPONSE };
      return this.refresh(apiKey);
    }

    return this.toClientResponse(persisted, apiKey);
  }

  async refresh(apiKey: string): Promise<OpenRouterCatalogResponse> {
    const [fullResponse, userResponse] = await Promise.all([
      this.fetchImpl('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      this.fetchImpl('https://openrouter.ai/api/v1/models/user', {
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
    ) as ProviderModelMap;

    let userModels: ProviderModelMap = {};
    if (userResponse.ok) {
      const userBody = await userResponse.json();
      userModels = Object.fromEntries(
        (userBody.data ?? []).map((entry: any) => {
          const fullModel = models[entry.id];
          const model = fullModel ?? mapOpenRouterModel(entry);
          return [model.id, model];
        }),
      ) as ProviderModelMap;
    }

    const persisted: PersistedOpenRouterCatalog = {
      models,
      userModels,
      syncedAt: new Date().toISOString(),
      userModelsKeyFingerprint: this.fingerprint(apiKey),
    };

    await this.writePersisted(persisted);
    return this.toClientResponse(persisted, apiKey);
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }

  getFilePath(): string {
    return this.filePath;
  }

  private fingerprint(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex');
  }

  private async readPersisted(): Promise<PersistedOpenRouterCatalog | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedOpenRouterCatalog>;
      return {
        models: parsed.models ?? {},
        userModels: parsed.userModels ?? {},
        syncedAt: parsed.syncedAt ?? null,
        userModelsKeyFingerprint: parsed.userModelsKeyFingerprint ?? null,
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  private async writePersisted(catalog: PersistedOpenRouterCatalog): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(catalog, null, 2), 'utf-8');
  }

  private toClientResponse(
    catalog: PersistedOpenRouterCatalog,
    apiKey?: string,
  ): OpenRouterCatalogResponse {
    if (!apiKey) {
      return {
        models: catalog.models,
        userModels: {},
        syncedAt: catalog.syncedAt,
        userModelsRequireRefresh: false,
      };
    }

    const matchesFingerprint =
      !catalog.userModelsKeyFingerprint ||
      catalog.userModelsKeyFingerprint === this.fingerprint(apiKey);

    return {
      models: catalog.models,
      userModels: matchesFingerprint ? catalog.userModels : {},
      syncedAt: catalog.syncedAt,
      userModelsRequireRefresh: !matchesFingerprint,
    };
  }
}
