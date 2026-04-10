import type { DiscoveredModelMetadata } from './agent-config';

export type ProviderModelMap = Record<string, DiscoveredModelMetadata>;

/** Generic catalog response for any provider instance. */
export interface ProviderCatalogResponse {
  models: ProviderModelMap;
  userModels: ProviderModelMap;
  syncedAt: string | null;
  userModelsRequireRefresh: boolean;
}

/**
 * @deprecated Use ProviderCatalogResponse instead.
 * Kept temporarily for migration — will be removed when all consumers switch.
 */
export type OpenRouterCatalogResponse = ProviderCatalogResponse;
