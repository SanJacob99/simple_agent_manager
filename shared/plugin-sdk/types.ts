import type { DiscoveredModelMetadata } from '../agent-config';

// --- Auth ---

export interface ProviderAuthMethod {
  methodId: string;
  label: string;
  type: 'api-key';
  envVar?: string;
  usesSavedKey?: boolean;
  validate?: (
    key: string,
    baseUrl: string,
    signal?: AbortSignal,
  ) => Promise<boolean>;
}

// --- Catalog ---

export interface ProviderCatalogContext {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface ProviderCatalogResult {
  models: Record<string, DiscoveredModelMetadata>;
  userModels?: Record<string, DiscoveredModelMetadata>;
}

export interface ProviderPluginCatalog {
  refresh: (ctx: ProviderCatalogContext) => Promise<ProviderCatalogResult>;
}

// --- Plugin definition ---

export interface ProviderPluginDefinition {
  id: string;
  name: string;
  description: string;
  runtimeProviderId: string;
  defaultBaseUrl: string;
  auth: ProviderAuthMethod[];
  catalog?: ProviderPluginCatalog;
  wrapStreamFn?: (
    ctx: import('./stream').ProviderWrapStreamFnContext,
  ) => import('./stream').StreamFn | undefined;
  webSearch?: import('./web-contracts').WebSearchProviderPlugin;
  webFetch?: import('./web-contracts').WebFetchProviderPlugin;
}

// --- Client-safe summary ---

export interface ProviderPluginSummary {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  auth: Array<
    Pick<ProviderAuthMethod, 'methodId' | 'label' | 'type' | 'envVar'>
  >;
  supportsCatalog: boolean;
  supportsWebSearch: boolean;
  supportsWebFetch: boolean;
}
