// server/hooks/hook-registry.ts
// Centralized hook registry — register, invoke (async waterfall), destroy.

import type { HookHandler, HookRegistration } from './hook-types';

interface StoredRegistration {
  pluginId: string;
  handler: HookHandler<any>;
  priority: number;
  critical: boolean;
}

/**
 * HookRegistry stores handlers per hook name and invokes them as an
 * async waterfall: each handler receives the (possibly mutated) context
 * from the previous handler.
 *
 * One instance per managed agent, plus one global instance for backend
 * lifecycle hooks.
 */
export class HookRegistry {
  private hooks = new Map<string, StoredRegistration[]>();
  private destroyed = false;

  /**
   * Register a handler for a hook name. Returns an unregister function.
   */
  register<TContext>(
    hookName: string,
    registration: HookRegistration<TContext>,
  ): () => void {
    if (this.destroyed) return () => {};

    const stored: StoredRegistration = {
      pluginId: registration.pluginId,
      handler: registration.handler,
      priority: registration.priority,
      critical: registration.critical,
    };

    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }

    const list = this.hooks.get(hookName)!;
    list.push(stored);

    // Keep sorted by priority (lower = earlier)
    list.sort((a, b) => a.priority - b.priority);

    return () => {
      const idx = list.indexOf(stored);
      if (idx !== -1) list.splice(idx, 1);
    };
  }

  /**
   * Invoke all handlers for a hook name in priority order (waterfall).
   * Each handler receives the context and may mutate it.
   * Returns the final context.
   */
  async invoke<TContext>(hookName: string, context: TContext): Promise<TContext> {
    if (this.destroyed) return context;

    const handlers = this.hooks.get(hookName);
    if (!handlers || handlers.length === 0) return context;

    for (const reg of handlers) {
      try {
        await reg.handler(context);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown hook error';
        console.error(
          `[HookRegistry] Error in ${reg.pluginId}/${hookName}: ${errorMsg}`,
        );

        if (reg.critical) {
          throw new Error(
            `Critical hook error in ${reg.pluginId}/${hookName}: ${errorMsg}`,
          );
        }
        // Non-critical: log and continue
      }
    }

    return context;
  }

  /**
   * Check if any handlers are registered for a hook name.
   */
  has(hookName: string): boolean {
    const handlers = this.hooks.get(hookName);
    return !!handlers && handlers.length > 0;
  }

  /**
   * Get the count of handlers registered for a hook name.
   */
  count(hookName: string): number {
    return this.hooks.get(hookName)?.length ?? 0;
  }

  /**
   * Remove all handlers for all hooks. Prevents future invocations.
   */
  destroy(): void {
    this.destroyed = true;
    this.hooks.clear();
  }
}
