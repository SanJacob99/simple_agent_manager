/**
 * Tool registry — filesystem-scan driven.
 *
 * At server startup (or in test setup), `initializeToolRegistry()` scans a
 * set of directories for files matching `*.module.ts` / `*.module.js`,
 * dynamically imports each one, and collects the `default` export as a
 * `ToolModule`. Built-in tools live under `server/tools/builtins/`; user
 * tools live under `server/tools/user/` (gitignored) and are loaded via
 * the `extraDirs` option — see `docs/concepts/user-tools-plan.md`.
 *
 * Consumer contract:
 *
 *   - `TOOL_MODULES` and `REGISTERED_TOOL_NAMES` are exported as live
 *     `ReadonlyArray` / `ReadonlySet` references over mutable internal
 *     state. Before `initializeToolRegistry()` completes they are empty.
 *   - `getToolModule`, `buildToolFromModule`, and friends throw a clear
 *     error if called before init. That is the loud signal we want — the
 *     only way a caller hits this path is by starting an agent runtime
 *     without a bootstrapped registry.
 *   - Calling `initializeToolRegistry()` twice is a no-op (the second
 *     call returns the in-flight promise).
 *   - Tests that want a fresh registry pass `resetForTests: true`.
 *
 * Adding a built-in tool is now a single-file change: drop a
 * `<tool>.module.ts` anywhere under `server/tools/builtins/` that
 * default-exports a `ToolModule`. No edit to this file required.
 */

import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL, fileURLToPath } from 'url';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import type { AgentConfig } from '../../shared/agent-config';
import type { ToolCatalogEntry } from '../../shared/tool-catalog';
import type { ToolClassification, ToolModule, RuntimeHints } from './tool-module';

// -- Mutable internal state --------------------------------------------------

const _TOOL_MODULES: ToolModule<any>[] = [];
const _TOOL_MODULES_BY_NAME = new Map<string, ToolModule<any>>();
const _REGISTERED_TOOL_NAMES = new Set<string>();
const _TOOL_SOURCES = new Map<string, 'builtin' | 'user'>();

let initialized = false;
let initPromise: Promise<void> | null = null;

// -- Live read-only exports --------------------------------------------------

/**
 * The discovered tool modules. Live reference — populated by
 * `initializeToolRegistry()`. Safe to read after init; empty before.
 */
export const TOOL_MODULES: ReadonlyArray<ToolModule<any>> = _TOOL_MODULES;

/**
 * Aliases — different user-facing names that map to the same registered
 * module. `bash` is the only alias today (historical: `bash` and `exec`
 * have always been the same underlying tool). Aliases are static; they
 * are registered without a filesystem scan.
 */
export const TOOL_ALIASES: Readonly<Record<string, string>> = {
  bash: 'exec',
};

/**
 * Every name that the registry claims — canonical module names PLUS
 * aliases. Live reference populated by `initializeToolRegistry()`.
 */
export const REGISTERED_TOOL_NAMES: ReadonlySet<string> = _REGISTERED_TOOL_NAMES;

// Aliases are known at module load; seed the registered-names set so the
// factory's alias dispatch works even if a test only exercises the alias.
for (const alias of Object.keys(TOOL_ALIASES)) _REGISTERED_TOOL_NAMES.add(alias);

// -- Discovery helpers -------------------------------------------------------

export interface InitializeToolRegistryOptions {
  /**
   * Directory containing built-in module files. Defaults to
   * `server/tools/builtins/` resolved relative to this file.
   */
  builtinsDir?: string;
  /**
   * Additional directories scanned after the built-ins. Use this to
   * load user-installed tools from `server/tools/user/` (or wherever
   * `SAM_USER_TOOLS_DIR` points). Missing or unreadable directories
   * are skipped with a warning — they must not crash the server.
   */
  extraDirs?: string[];
  /**
   * Drop all discovered state and re-run the scan. Only for tests.
   */
  resetForTests?: boolean;
}

function defaultBuiltinsDir(): string {
  // Resolve relative to THIS file so it works under tsx (source) and under
  // a compiled layout. `import.meta.url` is a file:// URL.
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), 'builtins');
}

async function walkModuleFiles(
  dir: string,
  opts: { failSoft: boolean },
): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err: any) {
      if (opts.failSoft) {
        if (err?.code !== 'ENOENT') {
          console.warn(
            `[tool-registry] could not scan ${current}: ${err?.message ?? err}`,
          );
        }
        return;
      }
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.module.ts') || entry.name.endsWith('.module.js'))
      ) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

function isToolModule(candidate: unknown): candidate is ToolModule<any> {
  if (!candidate || typeof candidate !== 'object') return false;
  const c = candidate as Record<string, unknown>;
  return (
    typeof c.name === 'string' &&
    typeof c.label === 'string' &&
    typeof c.description === 'string' &&
    typeof c.resolveContext === 'function' &&
    typeof c.create === 'function'
  );
}

async function loadModulesFromFiles(
  files: string[],
  source: 'builtin' | 'extra',
): Promise<ToolModule<any>[]> {
  const loaded: ToolModule<any>[] = [];
  for (const file of files) {
    try {
      const mod = await import(pathToFileURL(file).href);
      const def = mod?.default;
      if (!isToolModule(def)) {
        console.warn(
          `[tool-registry] ${file} does not default-export a valid ToolModule — skipping`,
        );
        continue;
      }
      loaded.push(def as ToolModule<any>);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (source === 'extra') {
        // User-supplied modules must never crash the server.
        console.error(`[tool-registry] failed to load ${file}: ${msg}`);
      } else {
        // A broken built-in is a programmer bug — surface it.
        throw new Error(`[tool-registry] failed to load built-in ${file}: ${msg}`);
      }
    }
  }
  return loaded;
}

function resetState(): void {
  _TOOL_MODULES.length = 0;
  _TOOL_MODULES_BY_NAME.clear();
  _REGISTERED_TOOL_NAMES.clear();
  _TOOL_SOURCES.clear();
  for (const alias of Object.keys(TOOL_ALIASES)) _REGISTERED_TOOL_NAMES.add(alias);
  initialized = false;
  initPromise = null;
}

/**
 * Scan the built-in and extra directories, load every `ToolModule`, and
 * populate the registry. Idempotent — subsequent calls resolve to the
 * first init promise unless `resetForTests` is set.
 */
export async function initializeToolRegistry(
  opts: InitializeToolRegistryOptions = {},
): Promise<void> {
  if (opts.resetForTests) resetState();
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const builtinsDir = opts.builtinsDir ?? defaultBuiltinsDir();
    const builtinFiles = await walkModuleFiles(builtinsDir, { failSoft: false });
    const builtins = await loadModulesFromFiles(builtinFiles, 'builtin');

    const extras: ToolModule<any>[] = [];
    for (const dir of opts.extraDirs ?? []) {
      const files = await walkModuleFiles(dir, { failSoft: true });
      extras.push(...(await loadModulesFromFiles(files, 'extra')));
    }

    // Dedup by name: built-ins win, extras fill in anything new. A
    // name-collision from an extra dir is logged and skipped — user tools
    // cannot silently override a built-in.
    const byName = new Map<string, ToolModule<any>>();
    const builtinNames = new Set<string>();
    for (const m of builtins) {
      if (byName.has(m.name)) {
        throw new Error(
          `[tool-registry] duplicate built-in tool name "${m.name}" — two .module files declared the same tool`,
        );
      }
      byName.set(m.name, m);
      builtinNames.add(m.name);
    }
    for (const m of extras) {
      if (byName.has(m.name)) {
        console.warn(
          `[tool-registry] user-installed tool "${m.name}" conflicts with a built-in or earlier extra — ignored`,
        );
        continue;
      }
      byName.set(m.name, m);
    }

    for (const m of byName.values()) {
      _TOOL_MODULES.push(m);
      _TOOL_MODULES_BY_NAME.set(m.name, m);
      _REGISTERED_TOOL_NAMES.add(m.name);
      _TOOL_SOURCES.set(m.name, builtinNames.has(m.name) ? 'builtin' : 'user');
    }
    initialized = true;
  })();
  return initPromise;
}

/**
 * Whether `initializeToolRegistry()` has finished. Used by tests and by
 * the server startup to sanity-check ordering.
 */
export function isToolRegistryInitialized(): boolean {
  return initialized;
}

/**
 * Catalog projection used by `GET /api/tools` and by anything on the
 * frontend that needs to know what tools exist (picker, system-prompt
 * advertisement). Only the UI-facing fields are exposed — secrets,
 * runtime factories, and config schemas stay server-side.
 *
 * The returned array is ordered by module-load order, which mirrors
 * filesystem discovery order: built-ins first, then user tools.
 */
export function getToolCatalog(): ToolCatalogEntry[] {
  ensureInitialized('getToolCatalog');
  return _TOOL_MODULES.map((m) => ({
    name: m.name,
    label: m.label,
    description: m.description,
    group: m.group,
    classification: m.classification,
  }));
}

/**
 * Counts of loaded modules by source, for the startup log. Safe to call
 * after `initializeToolRegistry()` completes; returns `{0, 0}` before.
 */
export function getToolSourceCounts(): { builtin: number; user: number } {
  let builtin = 0;
  let user = 0;
  for (const src of _TOOL_SOURCES.values()) {
    if (src === 'builtin') builtin += 1;
    else user += 1;
  }
  return { builtin, user };
}

function ensureInitialized(op: string): void {
  if (!initialized) {
    throw new Error(
      `Tool registry not initialized — ${op} called before \`await initializeToolRegistry()\`. ` +
      `Call it once at server startup (or in beforeAll for tests).`,
    );
  }
}

// -- Lookup API --------------------------------------------------------------

/** Resolve an alias to a canonical module name, or return the input unchanged. */
export function resolveToolName(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

/** Look up a module by name (aliases resolved). */
export function getToolModule(name: string): ToolModule<any> | undefined {
  ensureInitialized('getToolModule');
  return _TOOL_MODULES_BY_NAME.get(resolveToolName(name));
}

/**
 * Look up a tool's safety classification by name. Returns `undefined` when
 * the tool is unknown to the registry (session tools, unmigrated stubs,
 * plugin-supplied tools). Callers deciding how to treat an unclassified
 * tool should default to the most conservative behaviour.
 */
export function getToolClassification(name: string): ToolClassification | undefined {
  ensureInitialized('getToolClassification');
  return _TOOL_MODULES_BY_NAME.get(resolveToolName(name))?.classification;
}

/**
 * Group a resolved tool-name list by safety classification. Names without
 * a registered module are returned in `unclassified` so callers can decide
 * how to surface them (the confirmation policy treats them as
 * state-mutating by default). `ask_user` and `confirm_action` are
 * excluded from every bucket — they are the HITL gate itself, not
 * something the gate protects.
 */
export function groupToolsByClassification(names: Iterable<string>): {
  readOnly: string[];
  stateMutating: string[];
  destructive: string[];
  unclassified: string[];
} {
  ensureInitialized('groupToolsByClassification');
  const readOnly: string[] = [];
  const stateMutating: string[] = [];
  const destructive: string[] = [];
  const unclassified: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = resolveToolName(raw);
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === 'ask_user' || name === 'confirm_action') continue;
    const module = _TOOL_MODULES_BY_NAME.get(name);
    if (!module) {
      unclassified.push(name);
      continue;
    }
    switch (module.classification) {
      case 'read-only':
        readOnly.push(name);
        break;
      case 'destructive':
        destructive.push(name);
        break;
      case 'state-mutating':
      case undefined:
      default:
        stateMutating.push(name);
        break;
    }
  }
  return { readOnly, stateMutating, destructive, unclassified };
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
  ensureInitialized('buildToolFromModule');
  const module = _TOOL_MODULES_BY_NAME.get(resolveToolName(name));
  if (!module) return null;
  const ctx = module.resolveContext(config, runtime);
  return module.create(ctx, runtime);
}
