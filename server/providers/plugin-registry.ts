import type {
  ProviderPluginDefinition,
  ProviderPluginSummary,
} from '../../shared/plugin-sdk';

export class ProviderPluginRegistry {
  private plugins = new Map<string, ProviderPluginDefinition>();

  register(plugin: ProviderPluginDefinition): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Provider plugin "${plugin.id}" is already registered.`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(pluginId: string): ProviderPluginDefinition | undefined {
    return this.plugins.get(pluginId);
  }

  list(): ProviderPluginDefinition[] {
    return [...this.plugins.values()];
  }

  listSummaries(): ProviderPluginSummary[] {
    return this.list().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      defaultBaseUrl: p.defaultBaseUrl,
      auth: p.auth.map((a) => ({
        methodId: a.methodId,
        label: a.label,
        type: a.type,
        envVar: a.envVar,
      })),
      supportsCatalog: !!p.catalog,
      supportsWebSearch: !!p.webSearch,
      supportsWebFetch: !!p.webFetch,
    }));
  }

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }
}
