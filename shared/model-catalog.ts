import type { DiscoveredModelMetadata } from './agent-config';

export type ProviderModelMap = Record<string, DiscoveredModelMetadata>;

export interface OpenRouterCatalogResponse {
  models: ProviderModelMap;
  userModels: ProviderModelMap;
  syncedAt: string | null;
  userModelsRequireRefresh: boolean;
}
