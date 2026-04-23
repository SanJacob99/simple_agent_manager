# User-Installed Tools — Implementation Plan

> Forward-looking plan. Half the plumbing is in place (filesystem-scan
> discovery in [tool-registry.ts](../../server/tools/tool-registry.ts) accepts
> an `extraDirs` parameter). The rest of this doc describes what still
> needs to be wired up before users can drop a `.module.ts` file into
> `server/tools/user/` and have an agent use it.

<!-- last-verified: 2026-04-23 -->
<!-- status: M1 + M2 + M3 shipped — loader, UI discovery, and authoring UX. M4 (SDK package) still pending. -->

## Goal

A user can place a single TypeScript or JavaScript file at a known
location on disk, restart the server, and see their tool appear:

- in the Tools node's "Individual Tools" picker,
- in the agent's runtime tool list,
- in the confirmation policy's classification buckets.

No npm publish, no rebuild of `simple-agent-manager`, no edit of any
project source file.

## Non-goals (out of scope for v1)

- Sandboxing untrusted code. User tools run with full server privileges
  by design — the user owns the machine. We rely on the user vetting
  what they install, just like any plugin loader for VS Code or Vim.
- Hot reload. Restart-required is fine for v1.
- A package registry. v1 is "drop a file in a directory."
- Per-tool credential UI. v1 inherits whatever's in `AgentConfig` plus
  `process.env`.

## Where tools live

- Default: `server/tools/user/` — sibling of `server/tools/builtins/`,
  lives inside the backend source tree so tools ship and run with the
  same runtime (tsx, module resolution, path to `tool-module.ts`) as
  the built-ins. The directory is created on demand and gitignored by
  default — a `git pull` on the main repo will never touch or conflict
  with whatever a user has dropped in there.
- Override: `SAM_USER_TOOLS_DIR=/some/absolute/or/relative/path` —
  single dir. Useful for keeping a shared team library elsewhere on
  disk. Evolves to a comma-separated list only if anyone asks.
- Disable: `SAM_DISABLE_USER_TOOLS=1` — kill switch for CI / production
  containers that should never load local extras.

The directory is scanned recursively. A user can organize subfolders
however they like — same convention as built-ins under
`server/tools/builtins/<group>/<tool>.module.ts`.

## File format

Same as a built-in. A user tool is a single file ending in
`.module.ts` or `.module.js` whose default export is a `ToolModule`:

```ts
// server/tools/user/weather/weather.module.ts
import { defineTool } from '../../sdk';
// `sdk.ts` is the stability contract for user tools — it re-exports
// `defineTool` and the related types so internal refactors of
// `tool-module.ts` don't break user code. The worked example in
// `user-tools-guide.md` uses the same import.

export default defineTool({
  name: 'weather',
  label: 'Weather',
  description: 'Look up the current weather for a location',
  group: 'web',
  classification: 'read-only',
  resolveContext: (config) => ({
    apiKey: config.weatherApiKey || process.env.OPENWEATHER_API_KEY,
  }),
  create: (ctx) => {
    if (!ctx.apiKey) return null;
    return {
      name: 'weather',
      label: 'Weather',
      description: '…',
      parameters: { /* TypeBox schema */ },
      execute: async (_id, params) => { /* … */ },
    };
  },
});
```

`ToolModule` is the same interface defined in
[server/tools/tool-module.ts](../../server/tools/tool-module.ts).

## Loading mechanism (mostly already done)

`initializeToolRegistry({ extraDirs })` in
[tool-registry.ts](../../server/tools/tool-registry.ts) already:

- scans the directories recursively for `*.module.ts` / `*.module.js`,
- dynamically `import()`s each file,
- validates the default export looks like a `ToolModule`,
- skips broken files with a logged error rather than crashing,
- rejects user tools whose `name` collides with a built-in (built-ins
  win; the user's collision is logged and ignored).

Status:

1. **Resolve the user-tools dir at startup.** ✅ Shipped.
   [server/tools/resolve-user-tools-dir.ts](../../server/tools/resolve-user-tools-dir.ts)
   expands `~`, honors `SAM_USER_TOOLS_DIR` and `SAM_DISABLE_USER_TOOLS`,
   and returns `{ dirs, describe }`. [server/index.ts](../../server/index.ts)
   passes `dirs` as `extraDirs` to `initializeToolRegistry()`.
2. **Surface the loaded list.** ✅ Shipped. Startup logs
   `[Tools] N built-in + M user tool(s) loaded (<describe>).` The split
   is computed via `getToolSourceCounts()` on the registry.
3. **Expose a `/api/tools` endpoint.** ✅ Shipped. `GET /api/tools`
   returns the catalog via `getToolCatalog()` on the registry. Shape
   lives in [shared/tool-catalog.ts](../../shared/tool-catalog.ts).

## TypeScript-source vs compiled-JS

`tsx` is the project's runtime ESM loader; it transpiles `.ts` on the
fly via dynamic `import()`. So users can ship raw `.ts` files as long
as the server is launched with `tsx` (which it always is in this
project). Compiled `.js` works either way.

If we ever package a standalone binary (no tsx), we'd document
"compile your tool to .js first" — out of scope for v1.

## Configuration & credentials

Three layers, in order of precedence:

1. **`AgentConfig` fields.** A user tool can read any property from
   `config` in `resolveContext`. To make a new field configurable
   per-agent it needs a slot on `AgentConfig` — for v1 we'll let
   users add ad-hoc fields by extending the config interface
   (TypeScript will tolerate this if they cast).
2. **Environment variables.** Standard `process.env.WHATEVER` works.
   Same fallback pattern the built-ins use
   (`config.openaiApiKey || process.env.OPENAI_API_KEY`).
3. **Runtime hints.** The shared `RuntimeHints` (cwd, sandbox flag,
   model id, hitl, openrouter resolver, provider-web bundle) is passed
   to every `resolveContext`. User tools that want any of these get
   them for free.

For v2 we should design a per-tool config schema that the Tools node UI
can render — the same `ToolModule.config` field that exists today but
isn't yet used. That work is in
[adding-a-tool.md](./adding-a-tool.md).

## UI integration

Done in M2. The wiring:

- [server/index.ts](../../server/index.ts) exposes `GET /api/tools`,
  which calls `getToolCatalog()` on the registry and returns the
  array shape defined in
  [shared/tool-catalog.ts](../../shared/tool-catalog.ts).
- [src/store/tool-catalog-store.ts](../../src/store/tool-catalog-store.ts)
  fetches the endpoint on app mount (see
  [src/App.tsx](../../src/App.tsx)), exposes
  `{ tools, loaded, loading, error }`, and synthesises fallback
  entries from `ALL_TOOL_NAMES` when the backend is unreachable.
- [src/panels/property-editors/ToolsProperties.tsx](../../src/panels/property-editors/ToolsProperties.tsx)
  reads the live catalog, groups entries by `group` (known groups first
  in canonical order, user-declared groups alphabetical, ungrouped
  last), and uses each entry's `description` as the checkbox tooltip.
- [src/utils/graph-to-agent.ts](../../src/utils/graph-to-agent.ts)
  unions catalog-known names onto `IMPLEMENTED_TOOL_NAMES` when
  composing the system-prompt "Tools available" summary, so user
  tools get advertised to the model just like built-ins.

## Security model

- **Trust:** any code in `server/tools/user/` (or `SAM_USER_TOOLS_DIR`)
  runs with the same privileges as the server process. We do not
  isolate it. The path is owned by whoever deployed the server; if
  they put hostile code there, they have already lost.
- **Failure mode:** a broken user tool logs an error and is skipped.
  It must not crash the server (already enforced — `loadModulesFromFiles`
  uses `failSoft: true` for the 'extra' source).
- **Logging:** every successfully loaded user tool is announced at
  startup with its file path so the operator can audit what's running.
- **Kill switch:** `SAM_DISABLE_USER_TOOLS=1` skips the scan entirely.
  Document this for production deployments where the user-tools dir
  shouldn't be honored.

## Authoring & dev loop

The shipped flow (M3):

1. `npm run scaffold:tool -- <name>` →
   [scripts/scaffold-user-tool.ts](../../scripts/scaffold-user-tool.ts)
   generates `server/tools/user/<name>/<name>.module.ts` from a
   minimal runnable template. The script validates the name
   (snake_case, no collision with a built-in) and refuses to
   overwrite an existing directory.
2. Edit the generated file. Import `defineTool` and types from
   [server/tools/sdk.ts](../../server/tools/sdk.ts), not from
   `tool-module.ts` directly — the vendored SDK is the stability
   contract (see [user-tools-guide.md](./user-tools-guide.md)).
3. Restart the server (`npm run dev:server`). The startup line
   `[Tools] N built-in + M user tool(s) loaded (…)` confirms the
   load; broken files get a `[tool-registry]` error and are skipped.
4. Open the Tools node, find the tool under its `group` (or "other"
   if ungrouped), enable it.
5. Use it.

Reference and troubleshooting: [user-tools-guide.md](./user-tools-guide.md).

Still deferred (M4):

- A standalone `@simple-agent-manager/tool-sdk` npm package that
  re-exports the same names as `server/tools/sdk.ts`. Once it ships,
  user tools switch their `'../../sdk'` import to the package name
  and nothing else changes.

## Versioning / API stability

The `ToolModule` interface is the public contract for user tools.
Once we ship user-tools support, breaking changes to that interface
need a migration path:

- Keep the old shape supported via an adapter, or
- Rev a major version of `@simple-agent-manager/tool-sdk` and document
  the migration.

For v1, the surface is small (`name`, `label`, `description`, `group`,
`classification`, `resolveContext`, `create`, optional `config`),
which gives us room to evolve without churning user code.

## Milestones

A reasonable phasing once we decide to ship this:

1. **M1 — Loader plumbing (½ day).** ✅ Shipped. `resolveUserToolsDir()`
   helper lives at
   [server/tools/resolve-user-tools-dir.ts](../../server/tools/resolve-user-tools-dir.ts),
   `extraDirs` is threaded through `initializeToolRegistry()` from
   [server/index.ts](../../server/index.ts), and the startup log splits
   built-in vs user counts via `getToolSourceCounts()`.
2. **M2 — UI discovery (1 day).** ✅ Shipped. `GET /api/tools` lives in
   [server/index.ts](../../server/index.ts), the Zustand
   [tool-catalog-store](../../src/store/tool-catalog-store.ts) loads
   at app mount, and the Tools-node picker in
   [ToolsProperties.tsx](../../src/panels/property-editors/ToolsProperties.tsx)
   reads from it with grouping and description tooltips.
3. **M3 — Authoring UX (½ day).** ✅ Shipped.
   `npm run scaffold:tool -- <name>` generates
   `server/tools/user/<name>/<name>.module.ts` from a runnable template
   (script:
   [scripts/scaffold-user-tool.ts](../../scripts/scaffold-user-tool.ts)).
   The worked example + authoring reference live in
   [user-tools-guide.md](./user-tools-guide.md). User tools import the
   stable surface re-exported from
   [server/tools/sdk.ts](../../server/tools/sdk.ts) rather than
   `tool-module.ts` directly, so internal refactors won't break them.
4. **M4 — SDK package (deferred).** Extract `defineTool`,
   `ToolClassification`, `RuntimeHints` types into a published
   `@simple-agent-manager/tool-sdk` so user tools don't import from
   server internals.

## Open questions

- **Per-tool config UI.** The Tools node has hand-written editors for
  built-in tools (image, TTS, music, exec, code-execution). User tools
  need either (a) a generic schema-driven editor, (b) freeform JSON,
  or (c) skip per-agent config and rely entirely on env. **Lean: (a) —
  schema-driven, but only after the registry endpoint exists.**
- **Aliases.** Built-ins can declare aliases (`bash` → `exec`). Should
  user tools? **Lean: no for v1 — forces a unique top-level name and
  avoids confusing collisions.**
- **Stable API for shared utilities.** Tools that want to call the
  storage engine, or read other agent state, need an exported API.
  **Lean: don't expose anything beyond `RuntimeHints` + `AgentConfig`
  in v1; revisit when a real user request lands.**
- **Tool plugins shipped as npm packages.** The current Plugin SDK
  (`shared/plugin-sdk.ts`) is for *provider* plugins, not tool plugins.
  We could either reuse that machinery or keep tool plugins as raw
  files. **Lean: raw files for v1 — ship the easy thing first.**
