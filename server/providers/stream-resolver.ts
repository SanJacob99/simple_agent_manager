import type { ProviderPluginDefinition } from '../../shared/plugin-sdk';
import type { ProviderWrapStreamFnContext, StreamFn } from '../../shared/plugin-sdk';

/**
 * Resolve the composed StreamFn for a provider plugin.
 *
 * Resolution order:
 * 1. Start with base StreamFn (undefined = pi-agent-core default)
 * 2. If plugin has streamFamily, apply family hooks (future)
 * 3. If plugin has custom wrapStreamFn, apply it
 * 4. Return composed StreamFn
 */
export function resolveProviderStreamFn(
  plugin: ProviderPluginDefinition,
  ctx: ProviderWrapStreamFnContext,
): StreamFn | undefined {
  let streamFn = ctx.streamFn;

  // streamFamily hooks would be applied here once buildProviderStreamFamilyHooks()
  // is ported from OpenClaw. For v1 this is a pass-through.

  if (plugin.wrapStreamFn) {
    streamFn = plugin.wrapStreamFn({ ...ctx, streamFn });
  }

  return streamFn;
}
