import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { ProviderModelMap, ProviderCatalogResponse } from '../../shared/model-catalog';
import type { ProviderPluginDefinition, ProviderCatalogContext, ProviderCatalogRequest } from '../../shared/plugin-sdk';
import { buildCatalogCacheKey, normalizeBaseUrl } from './provider-auth';

export type { ProviderCatalogRequest } from '../../shared/plugin-sdk';

interface PersistedCatalog {
  models: ProviderModelMap;
  userModels: ProviderModelMap;
  syncedAt: string | null;
  userModelsKeyFingerprint: string | null;
}

const EMPTY_RESPONSE: ProviderCatalogResponse = {
  models: {},
  userModels: {},
  syncedAt: null,
  userModelsRequireRefresh: false,
};

export class ProviderCatalogCache {
  constructor(private readonly cacheDir: string = process.cwd()) {}

  private filePath(request: ProviderCatalogRequest): string {
    const key = buildCatalogCacheKey(request.pluginId, request.baseUrl);
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
    return path.join(this.cacheDir, `provider-catalog-${request.pluginId}-${hash}.json`);
  }

  private fingerprint(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex');
  }

  async load(
    request: ProviderCatalogRequest,
    apiKeyFingerprint?: string,
  ): Promise<ProviderCatalogResponse | null> {
    const persisted = await this.readPersisted(request);
    if (!persisted) return null;
    return this.toClientResponse(persisted, apiKeyFingerprint);
  }

  async refresh(
    request: ProviderCatalogRequest,
    plugin: ProviderPluginDefinition,
    ctx: ProviderCatalogContext,
  ): Promise<ProviderCatalogResponse> {
    if (!plugin.catalog) {
      return { ...EMPTY_RESPONSE };
    }

    const result = await plugin.catalog.refresh(ctx);

    const persisted: PersistedCatalog = {
      models: result.models,
      userModels: result.userModels ?? {},
      syncedAt: new Date().toISOString(),
      userModelsKeyFingerprint: ctx.apiKey ? this.fingerprint(ctx.apiKey) : null,
    };

    await this.writePersisted(request, persisted);
    return this.toClientResponse(
      persisted,
      ctx.apiKey ? this.fingerprint(ctx.apiKey) : undefined,
    );
  }

  async clear(request: ProviderCatalogRequest): Promise<void> {
    await fs.rm(this.filePath(request), { force: true });
  }

  async clearAll(): Promise<void> {
    try {
      const entries = await fs.readdir(this.cacheDir);
      await Promise.all(
        entries
          .filter((f) => f.startsWith('provider-catalog-') && f.endsWith('.json'))
          .map((f) => fs.rm(path.join(this.cacheDir, f), { force: true })),
      );
    } catch {
      // Directory may not exist
    }
  }

  // --- Private helpers ---

  private async readPersisted(
    request: ProviderCatalogRequest,
  ): Promise<PersistedCatalog | null> {
    try {
      const raw = await fs.readFile(this.filePath(request), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedCatalog>;
      return {
        models: parsed.models ?? {},
        userModels: parsed.userModels ?? {},
        syncedAt: parsed.syncedAt ?? null,
        userModelsKeyFingerprint: parsed.userModelsKeyFingerprint ?? null,
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async writePersisted(
    request: ProviderCatalogRequest,
    catalog: PersistedCatalog,
  ): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath(request)), { recursive: true });
    await fs.writeFile(
      this.filePath(request),
      JSON.stringify(catalog, null, 2),
      'utf-8',
    );
  }

  private toClientResponse(
    catalog: PersistedCatalog,
    apiKeyFingerprint?: string,
  ): ProviderCatalogResponse {
    if (!apiKeyFingerprint) {
      return {
        models: catalog.models,
        userModels: {},
        syncedAt: catalog.syncedAt,
        userModelsRequireRefresh: false,
      };
    }

    const matchesFingerprint =
      !catalog.userModelsKeyFingerprint ||
      catalog.userModelsKeyFingerprint === apiKeyFingerprint;

    return {
      models: catalog.models,
      userModels: matchesFingerprint ? catalog.userModels : {},
      syncedAt: catalog.syncedAt,
      userModelsRequireRefresh: !matchesFingerprint,
    };
  }
}
