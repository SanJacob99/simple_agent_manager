/**
 * Tool registry — the single, authoritative list of `ToolModule`
 * instances that have been migrated to the self-describing pattern.
 *
 * `tool-factory.ts` consults this registry BEFORE falling back to its
 * legacy per-name switch statement, so migrated and non-migrated tools
 * coexist cleanly during the transition.
 *
 * Adding a migrated tool:
 *   1. Create `<tool>.module.ts` next to the tool implementation.
 *   2. Import its default export below.
 *   3. Add it to the `TOOL_MODULES` array.
 *
 * Future: this barrel becomes obsolete once filesystem-scan discovery
 * lands (see `docs/concepts/adding-a-tool.md`). The one-line-per-tool
 * regime is already a large improvement over the current 6-files edit
 * surface every new tool creates.
 */

import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import type { AgentConfig } from '../../shared/agent-config';
import type { ToolModule, RuntimeHints } from './tool-module';

// -- Migrated tool modules ---------------------------------------------------
import calculatorModule from './builtins/calculator/calculator.module';
import askUserModule from './builtins/human/ask-user.module';
import confirmActionModule from './builtins/human/confirm-action.module';
import execModule from './builtins/exec/exec.module';
import readFileModule from './builtins/fs/read-file.module';
import writeFileModule from './builtins/fs/write-file.module';
import editFileModule from './builtins/fs/edit-file.module';
import listDirectoryModule from './builtins/fs/list-directory.module';
import applyPatchModule from './builtins/fs/apply-patch.module';
import imageAnalyzeModule from './builtins/image/image-analyze.module';
import showImageModule from './builtins/image/show-image.module';

/**
 * The registered tool modules. Order is irrelevant at runtime — names are
 * unique and lookups go through the `by name` map. Alphabetize for human
 * scanning / diff legibility.
 */
export const TOOL_MODULES: ReadonlyArray<ToolModule<any>> = [
  applyPatchModule,
  askUserModule,
  calculatorModule,
  confirmActionModule,
  editFileModule,
  execModule,
  imageAnalyzeModule,
  listDirectoryModule,
  readFileModule,
  showImageModule,
  writeFileModule,
];

/**
 * Aliases — different user-facing names that map to the same registered
 * module. `bash` is the only alias today (historical: `bash` and `exec`
 * have always been the same underlying tool). New aliases must map to a
 * name that exists in `TOOL_MODULES` above.
 */
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  bash: 'exec',
};

const TOOL_MODULES_BY_NAME: ReadonlyMap<string, ToolModule<any>> = new Map(
  TOOL_MODULES.map((m) => [m.name, m]),
);

/** Resolve an alias to a canonical module name, or return the input unchanged. */
export function resolveToolName(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

/** Look up a module by name (aliases resolved). */
export function getToolModule(name: string): ToolModule<any> | undefined {
  return TOOL_MODULES_BY_NAME.get(resolveToolName(name));
}

/**
 * Build an `AgentTool` for the named module, or `null` if the module
 * either does not exist in the registry or chose not to produce a tool
 * for the given config (e.g. missing API key). Resolves aliases first.
 *
 * This is the integration seam for `tool-factory.ts`.
 */
export function buildToolFromModule(
  name: string,
  config: AgentConfig,
  runtime: RuntimeHints,
): AgentTool<TSchema> | null {
  const module = TOOL_MODULES_BY_NAME.get(resolveToolName(name));
  if (!module) return null;
  const ctx = module.resolveContext(config, runtime);
  return module.create(ctx, runtime);
}

/**
 * Every name that the registry claims — canonical module names PLUS
 * aliases. Used by the legacy factory to decide whether a name has been
 * "claimed" by the module registry and therefore should be skipped by
 * its switch statement.
 */
export const REGISTERED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...TOOL_MODULES.map((m) => m.name),
  ...Object.keys(TOOL_ALIASES),
]);
