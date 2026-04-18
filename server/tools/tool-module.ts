/**
 * ToolModule — self-describing tool definition.
 *
 * A module owns everything the rest of the system needs to know about a
 * tool: its name, group, description, per-agent config schema + defaults,
 * the mapping from `AgentConfig` to the tool's runtime context, and the
 * `create()` factory that produces an `AgentTool`.
 *
 * Benefits over the legacy "switch inside tool-factory + entries in three
 * shared arrays" pattern:
 *
 *   - Adding a tool touches ONE source file per tool (plus a single
 *     registry line until filesystem discovery lands).
 *   - No merge conflicts between parallel tool-branch PRs on the same
 *     central registry file regions.
 *   - Tool metadata (group, description, classification) travels with
 *     the tool itself, not scattered across three repos.
 *   - Config schema travels with the tool → eventually the Tools node UI
 *     can auto-render config pages from the schema instead of requiring
 *     a hand-written page per tool.
 *
 * This is additive: tools that have been migrated to modules are served
 * out of `TOOL_MODULES` (see `tool-registry.ts`); tools that have not are
 * still handled by the legacy switch in `tool-factory.ts`.
 */

import type { TSchema } from '@sinclair/typebox';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { AgentConfig } from '../../shared/agent-config';
import type { ProviderPluginDefinition } from '../../shared/plugin-sdk';
import type { AskUserContext } from './builtins/human/ask-user';

/**
 * Provider-plugin web tool context. Passed through to `web_search` /
 * `web_fetch` modules so they can delegate to a plugin-supplied
 * implementation (e.g. an OpenRouter provider that has its own search
 * endpoint) before falling back to the built-in tools.
 */
export interface ProviderWebContext {
  plugin: ProviderPluginDefinition;
  apiKey: string;
  baseUrl: string;
}

/**
 * Safety classification. The confirmation policy currently treats all
 * non-HITL tools uniformly, but this field gives us a hook for future
 * per-classification overrides ("auto-confirm read-only") without
 * scattering tool-specific rules through the policy code.
 */
export type ToolClassification = 'read-only' | 'state-mutating' | 'destructive';

/**
 * Shared runtime hints passed to every tool module's `resolveContext` and
 * `create`. These are genuinely cross-cutting concerns — per-tool context
 * fields belong inside the module's own resolvedContext type.
 */
export interface RuntimeHints {
  /** Agent workspace directory (resolved, never empty — falls back to process.cwd). */
  cwd: string;
  /** When true, tools that accept a workdir parameter must restrict it under `cwd`. */
  sandboxWorkdir?: boolean;
  /** The resolving model id — used by tools that need provider-specific fallbacks. */
  modelId?: string;
  /** HITL context. Only present when the HITL registry has been wired. */
  hitl?: AskUserContext;
  /**
   * Lazy OpenRouter key resolver — used by tools (e.g. image_generate) that
   * want to piggyback on the user's existing OpenRouter credentials without
   * a separate key field.
   */
  getOpenrouterApiKey?: () => Promise<string | undefined> | string | undefined;
  /**
   * Provider-plugin web tool bundle. When a connected provider exports
   * `webSearch` or `webFetch` (e.g. OpenRouter), the matching tool modules
   * prefer it over their built-in implementations.
   */
  providerWeb?: ProviderWebContext;
}

/**
 * A tool module. `TContext` is the module's own runtime context shape —
 * the output of `resolveContext`, which is then fed into `create`.
 */
export interface ToolModule<TContext = unknown> {
  /** Canonical tool name. Must be unique across all modules. */
  name: string;
  /** Human-readable label for the Tools node UI. */
  label: string;
  /** Short, model-facing description (falls through to the `AgentTool.description`). */
  description: string;
  /**
   * Tool group this module belongs to — matches one of the keys in
   * `TOOL_GROUPS` in `shared/resolve-tool-names.ts`. Optional: tools
   * without a group still exist, they just don't appear under any
   * group checkbox in the Tools node UI and have to be enabled
   * individually in the "Individual Tools" list.
   */
  group?: string;
  /** Lucide icon name used by the Tools node UI. Optional. */
  icon?: string;
  /** Safety classification. Default: 'state-mutating' (conservative). */
  classification?: ToolClassification;

  /**
   * Per-agent config schema + defaults. Optional. Only tools that take
   * user-provided configuration (API keys, preferences, skill text) need
   * this — simple tools like `calculator` omit it entirely.
   *
   * The schema is currently informational — hand-written UI pages in
   * `ToolsProperties.tsx` still drive the actual editors. A future
   * iteration (see `docs/concepts/adding-a-tool.md`) will auto-render
   * forms from this schema so the UI page becomes optional too.
   */
  config?: {
    schema: TSchema;
    defaults: unknown;
  };

  /**
   * Pure function mapping the global `AgentConfig` + runtime hints to the
   * subset of configuration this specific tool needs. Called once at tool
   * construction time.
   */
  resolveContext: (config: AgentConfig, runtime: RuntimeHints) => TContext;

  /**
   * Build the actual `AgentTool`. May return `null` when the tool is not
   * usable with the current context (e.g. required API key missing). The
   * registry skips nulls so partially-configured agents don't advertise
   * broken tools to the model.
   */
  create: (ctx: TContext, runtime: RuntimeHints) => AgentTool<TSchema> | null;
}

/**
 * Identity helper that exists solely to pin the generic parameter of
 * `ToolModule<T>` on the author's definition. Without it TypeScript will
 * widen the context type to `unknown` at the call site and lose inference
 * on `create`.
 *
 * Usage:
 *
 *     export default defineTool({
 *       name: 'weather',
 *       ...
 *       resolveContext: (cfg) => ({ apiKey: cfg.weatherApiKey }),
 *       create: (ctx) => ctx.apiKey ? createWeatherTool(ctx) : null,
 *     });
 */
export function defineTool<TContext>(module: ToolModule<TContext>): ToolModule<TContext> {
  return module;
}
