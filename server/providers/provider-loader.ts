import fs from 'fs/promises';
import { PLUGIN_MAP } from './plugins/index';
import type { ProviderPluginRegistry } from './plugin-registry';

interface ProviderConfigEntry {
  id: string;
  enabled: boolean;
}

interface ProvidersConfig {
  providers: ProviderConfigEntry[];
}

export async function loadProviderPlugins(
  configPath: string,
  registry: ProviderPluginRegistry,
): Promise<void> {
  let config: ProvidersConfig;
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw) as ProvidersConfig;
  } catch {
    // No config file — register all known plugins as enabled by default
    for (const plugin of Object.values(PLUGIN_MAP)) {
      registry.register(plugin);
    }
    console.log(
      `[Providers] No providers.json found at ${configPath}; loaded ${Object.keys(PLUGIN_MAP).length} default plugin(s).`,
    );
    return;
  }

  for (const entry of config.providers) {
    if (!entry.enabled) continue;

    const plugin = PLUGIN_MAP[entry.id];
    if (!plugin) {
      console.warn(
        `[Providers] Config references plugin "${entry.id}" but no implementation found in PLUGIN_MAP. Skipping.`,
      );
      continue;
    }

    registry.register(plugin);
  }

  console.log(
    `[Providers] Loaded ${registry.list().length} plugin(s) from ${configPath}.`,
  );
}
