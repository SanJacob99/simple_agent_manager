// server/hooks/internal-hooks.ts
// Built-in hook registrations for internal subsystems.

import type { HookRegistry } from './hook-registry';
import type { AgentConfig } from '../../shared/agent-config';
import { HOOK_NAMES, type AgentBootstrapContext } from './hook-types';

/**
 * Register internal (built-in) hooks on the agent's HookRegistry.
 * These run at high priority (10) before any plugin hooks.
 */
export function registerInternalHooks(
  registry: HookRegistry,
  _config: AgentConfig,
): void {
  // --- agent:bootstrap ---
  // Applies added/removed files to the bootstrap file list.
  // Other internal systems can register additional bootstrap hooks.
  registry.register<AgentBootstrapContext>(HOOK_NAMES.AGENT_BOOTSTRAP, {
    pluginId: 'internal',
    handler: (ctx) => {
      // Apply removals
      if (ctx.removed.length > 0) {
        ctx.bootstrapFiles = ctx.bootstrapFiles.filter(
          (f) => !ctx.removed.includes(f.name),
        );
      }
      // Apply additions
      if (ctx.added.length > 0) {
        ctx.bootstrapFiles.push(...ctx.added);
      }
    },
    priority: 10,
    critical: false,
  });
}
