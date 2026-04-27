import type { ProviderPluginDefinition } from '../../shared/plugin-sdk';
import type { ProviderWrapStreamFnContext, StreamFn } from '../../shared/plugin-sdk';

/**
 * Resolve the composed StreamFn for a provider plugin. Starts from the
 * pi-agent-core default (undefined) and lets the plugin wrap it via
 * `wrapStreamFn` for any provider-specific transforms.
 */
export function resolveProviderStreamFn(
  plugin: ProviderPluginDefinition,
  ctx: ProviderWrapStreamFnContext,
): StreamFn | undefined {
  let streamFn = ctx.streamFn;
  if (plugin.wrapStreamFn) {
    streamFn = plugin.wrapStreamFn({ ...ctx, streamFn });
  }
  return streamFn;
}
