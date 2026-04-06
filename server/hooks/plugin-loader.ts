// server/hooks/plugin-loader.ts
// Loads plugin modules from the filesystem and registers their hooks.

import type { HookRegistry } from './hook-registry';
import type { PluginHookBinding, PluginDefinition } from '../../shared/agent-config';
import path from 'path';

const DEFAULT_PRIORITY = 100;

/**
 * PluginLoader resolves plugin hook handler modules from the filesystem
 * and registers them with the HookRegistry.
 *
 * Handler modules must export a default function matching the hook's
 * expected HookHandler<TContext> signature.
 */
export class PluginLoader {
  /**
   * Load all enabled plugins and register their hooks.
   *
   * @param plugins - Plugin definitions from AgentConfig
   * @param registry - The agent's HookRegistry
   * @param basePath - Base path for resolving relative module paths
   */
  static async loadPlugins(
    plugins: PluginDefinition[] | undefined,
    registry: HookRegistry,
    basePath: string,
  ): Promise<number> {
    if (!plugins || plugins.length === 0) return 0;

    let loaded = 0;

    for (const plugin of plugins) {
      if (!plugin.enabled) {
        console.log(`[PluginLoader] Skipping disabled plugin: ${plugin.name}`);
        continue;
      }

      if (!plugin.hooks || plugin.hooks.length === 0) continue;

      for (const binding of plugin.hooks) {
        try {
          const handler = await PluginLoader.resolveHandler(
            binding.handler,
            basePath,
          );

          registry.register(binding.hookName, {
            pluginId: plugin.id,
            handler,
            priority: binding.priority ?? DEFAULT_PRIORITY,
            critical: binding.critical ?? false,
          });

          console.log(
            `[PluginLoader] Registered ${plugin.name}/${binding.hookName} (priority: ${binding.priority ?? DEFAULT_PRIORITY})`,
          );
          loaded++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          console.error(
            `[PluginLoader] Failed to load handler for ${plugin.name}/${binding.hookName}: ${msg}`,
          );
          // Continue loading other handlers — fail-open
        }
      }
    }

    return loaded;
  }

  /**
   * Resolve a handler module path and return its default export.
   */
  private static async resolveHandler(
    handlerPath: string,
    basePath: string,
  ): Promise<(context: any) => Promise<void> | void> {
    const resolved = path.isAbsolute(handlerPath)
      ? handlerPath
      : path.resolve(basePath, handlerPath);

    let mod: any;
    try {
      mod = await import(resolved);
    } catch (err) {
      throw new Error(
        `Cannot load module at ${resolved}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    const handler = mod.default ?? mod;

    if (typeof handler !== 'function') {
      throw new Error(
        `Module at ${resolved} does not export a function (got ${typeof handler})`,
      );
    }

    return handler;
  }
}
