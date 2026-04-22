# User-Installed Tools — Implementation Plan

> Forward-looking plan. Half the plumbing is in place (filesystem-scan
> discovery in [tool-registry.ts](../../server/tools/tool-registry.ts) accepts
> an `extraDirs` parameter). The rest of this doc describes what still
> needs to be wired up before users can drop a `.module.ts` file into
> `server/tools/user/` and have an agent use it.

<!-- last-verified: 2026-04-18 -->
<!-- status: draft / not implemented -->

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
import { defineTool } from '../../tool-module';
// Because user tools live inside the backend tree, they import the SDK
// surface (`defineTool`, types) from the same relative path that built-ins
// use. No package install required.

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

What's still required:

1. **Resolve the user-tools dir at startup.** In
   [server/index.ts](../../server/index.ts), pass
   `extraDirs: resolveUserToolsDir()` into `initializeToolRegistry()`.
   The helper expands `~`, honors `SAM_USER_TOOLS_DIR` and
   `SAM_DISABLE_USER_TOOLS`, returns `[]` when disabled.
2. **Surface the loaded list.** Print
   `[Tools] N built-in + M user tool(s) loaded` so users can see their
   module took effect at boot.
3. **Expose a `/api/tools` endpoint** so the frontend can populate the
   Tools node picker dynamically (today the picker is fed by the
   hardcoded `IMPLEMENTED_TOOL_NAMES` constant in
   [shared/resolve-tool-names.ts](../../shared/resolve-tool-names.ts)).

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

The Tools node currently builds its picker from the hardcoded
`IMPLEMENTED_TOOL_NAMES` set in
[shared/resolve-tool-names.ts](../../shared/resolve-tool-names.ts).
For user tools to show up there we need:

- A new HTTP endpoint `GET /api/tools` that returns
  `{ name, label, group, classification, description }[]` for every
  registered module.
- A frontend store that fetches that list at app start, falls back to
  `IMPLEMENTED_TOOL_NAMES` when offline.
- The Tools node's "Individual Tools" picker reads from the store,
  groups by `group`, displays the description in a tooltip.

This is the largest piece of remaining work — about a day.

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

For v1, a user authoring a tool will:

1. Create `server/tools/user/<name>/<name>.module.ts`.
2. Implement `ToolModule` (copy a built-in as a starting template).
3. Restart the server.
4. Open the Tools node, find their tool, enable it.
5. Use it.

For better UX later we can ship:

- A starter template generator (`npx @simple-agent-manager/scaffold weather`).
- A docs page that lists every utility a user tool can import (the
  shape of `RuntimeHints`, what's in `AgentConfig`, the `defineTool`
  helper).
- A small `@simple-agent-manager/tool-sdk` npm package that re-exports
  `defineTool`, `ToolClassification`, common TypeBox helpers — so user
  tools can `import` from a stable surface instead of digging into
  internal paths.

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

1. **M1 — Loader plumbing (½ day).** `resolveUserToolsDir()` helper,
   pass `extraDirs` to `initializeToolRegistry()` from `server/index.ts`,
   update startup log, write the env-var docs.
2. **M2 — UI discovery (1 day).** `GET /api/tools` endpoint, frontend
   tool catalog store, Tools node picker reads from the store.
3. **M3 — Authoring UX (½ day).** Template generator, concept doc with
   a worked example, vendored `defineTool` import path.
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
