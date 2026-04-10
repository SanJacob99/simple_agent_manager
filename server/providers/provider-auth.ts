import type { ResolvedProviderConfig } from '../../shared/agent-config';
import type { ProviderPluginDefinition } from '../../shared/plugin-sdk';
import type { ApiKeyStore } from '../auth/api-keys';

export interface ResolvedProviderRuntimeAuth {
  apiKey: string | null;
  baseUrl: string;
}

/**
 * Normalize a base URL: trim whitespace, strip trailing slash.
 */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

/**
 * Build a cache key for catalog lookups: pluginId + normalized base URL.
 */
export function buildCatalogCacheKey(pluginId: string, baseUrl: string): string {
  return `${pluginId}::${normalizeBaseUrl(baseUrl)}`;
}

/**
 * Resolve the actual API key and base URL for a provider at runtime.
 *
 * Resolution order for API key:
 *   1. Saved key in ApiKeyStore (keyed by pluginId)
 *   2. Environment variable fallback (config.envVar)
 *
 * Resolution for base URL:
 *   1. Node override (config.baseUrl) if non-empty
 *   2. Plugin's defaultBaseUrl
 */
export function resolveProviderRuntimeAuth(
  config: ResolvedProviderConfig,
  plugin: ProviderPluginDefinition,
  apiKeys: ApiKeyStore,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProviderRuntimeAuth {
  // Resolve API key: saved key first, then env var fallback
  const savedKey = apiKeys.get(plugin.id);
  const envKey = config.envVar ? env[config.envVar] : undefined;
  const apiKey = savedKey || envKey || null;

  // Resolve base URL: node override first, then plugin default
  const rawBaseUrl = config.baseUrl || plugin.defaultBaseUrl;
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  return { apiKey, baseUrl };
}
