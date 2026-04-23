# User-Installed Tools

<!-- last-verified: 2026-04-23 -->

SAM lets you add tools to your own install without forking the main
codebase. Drop a `*.module.ts` file under `server/tools/user/`,
restart the server, and your tool shows up in the Tools-node picker
alongside the built-ins.

Two audiences to keep in mind:

- **Authors** writing their first user tool — start with
  [Quick start](#quick-start), walk through
  [Worked example](#worked-example--a-weather-tool), and reach for
  [What you can read at build time](#what-you-can-read-at-build-time)
  and [Common gotchas](#common-gotchas) as you iterate.
- **Maintainers** of the loader and extension points —
  [Design notes](#design-notes) at the bottom capture goals, the
  stability contract, and the still-open questions.

For the general `AgentTool` anatomy (execute results, the safety
classification, schema conventions), read
[adding-a-tool.md](./adding-a-tool.md) first. This page covers only
the user-install path on top of that.

---

## Quick start

```bash
npm run scaffold:tool -- weather
# created server/tools/user/weather/weather.module.ts
```

The scaffold validates the name (snake_case, no built-in collision),
creates the directory, and writes a minimal runnable `ToolModule`.
Edit the generated file, restart the server, open the Tools node, and
enable the tool.

---

## Where tools live

- **Default:** `server/tools/user/<name>/<name>.module.ts`. Created on
  demand and gitignored — `git pull` on the main repo will never
  touch what you drop in here.
- **Override the directory:** `SAM_USER_TOOLS_DIR=/some/absolute/path`.
  Useful for a shared team library on disk. A leading `~/` expands to
  your home directory.
- **Kill switch:** `SAM_DISABLE_USER_TOOLS=1` — production containers
  or CI that should never load local extras.

Implementation:
[server/tools/resolve-user-tools-dir.ts](../../server/tools/resolve-user-tools-dir.ts).
The directory is scanned recursively — organise subfolders however you
like, same convention as built-ins under
`server/tools/builtins/<group>/<tool>.module.ts`.

At boot the server prints how many user tools it loaded:

```
[Tools] 22 built-in + 1 user tool(s) loaded (default /…/server/tools/user).
```

If your count didn't tick up by one, check the server log for a
`[tool-registry]` line — broken user tools are logged and skipped,
never crash the server.

---

## The import surface

Every user tool imports from the vendored SDK file at
[server/tools/sdk.ts](../../server/tools/sdk.ts):

```ts
// server/tools/user/weather/weather.module.ts
import { defineTool } from '../../sdk';
import type { RuntimeHints } from '../../sdk';
```

`sdk.ts` re-exports a stable subset of the internal tool API:

| Name                 | What it is                                            |
|----------------------|-------------------------------------------------------|
| `defineTool`         | Identity helper; pins the generic on your definition. |
| `ToolModule<TCtx>`   | Interface your default export must satisfy.           |
| `ToolClassification` | `'read-only' \| 'state-mutating' \| 'destructive'`.   |
| `RuntimeHints`       | The second arg to `resolveContext` / `create`.        |
| `ProviderWebContext` | Present on `RuntimeHints` when a web-capable provider is connected. |

Do **not** import from `../../tool-module` directly — internal
refactors can move or rename things. `sdk.ts` is the stability
contract; anything you import from it will either keep working or
ship with a documented migration path. See
[Versioning / API stability](#versioning--api-stability) for detail.

---

## Worked example — a `weather` tool

Below is a complete, realistic user tool that calls OpenWeatherMap.
It reads a per-agent API key from `AgentConfig`, falls back to an
env var, and returns a short summary the model can quote.

```ts
// server/tools/user/weather/weather.module.ts
import { Type } from '@sinclair/typebox';
import { defineTool } from '../../sdk';

interface WeatherContext {
  apiKey: string | undefined;
}

export default defineTool<WeatherContext>({
  name: 'weather',
  label: 'Weather',
  description:
    'Look up the current weather for a city. Use when the user asks ' +
    'about outdoor conditions; do not use for historical or forecast ' +
    'data.',
  // Declaring a group is optional. If you pick one, it must match a
  // key in shared/resolve-tool-names.ts → TOOL_GROUPS, otherwise the
  // tool shows up under "other" in the picker — which is also fine.
  group: 'web',
  classification: 'read-only',

  // Read whatever this tool needs out of AgentConfig here. The object
  // you return is passed to `create` below.
  resolveContext: (config) => ({
    // AgentConfig is a serializable JSON object. For fields we don't
    // have a first-class slot for yet, cast and read — the config is
    // permissive enough to carry ad-hoc keys between the UI and the
    // backend (the UI persists whatever you put on the node).
    apiKey:
      (config as { weatherApiKey?: string }).weatherApiKey ||
      process.env.OPENWEATHER_API_KEY,
  }),

  // Return null to opt out — the registry skips nulls so partially-
  // configured agents don't advertise a broken tool to the model.
  create: (ctx) => {
    if (!ctx.apiKey) return null;
    return {
      name: 'weather',
      label: 'Weather',
      description: 'Look up the current weather for a city.',
      parameters: Type.Object({
        city: Type.String({ description: 'City name, e.g. "Berlin".' }),
      }),
      execute: async (_toolCallId, params, signal) => {
        const url =
          `https://api.openweathermap.org/data/2.5/weather` +
          `?q=${encodeURIComponent(params.city)}` +
          `&units=metric&appid=${ctx.apiKey}`;
        const res = await fetch(url, { signal });
        if (!res.ok) {
          throw new Error(`weather API returned ${res.status}`);
        }
        const json = (await res.json()) as {
          main?: { temp?: number };
          weather?: Array<{ description?: string }>;
        };
        const temp = json.main?.temp;
        const desc = json.weather?.[0]?.description;
        return {
          content: [
            {
              type: 'text' as const,
              text:
                typeof temp === 'number' && desc
                  ? `${params.city}: ${temp}°C, ${desc}.`
                  : `No weather data found for "${params.city}".`,
            },
          ],
          details: { temp, desc },
        };
      },
    };
  },
});
```

Three patterns worth noticing:

1. **`resolveContext` is a pure function.** No I/O, no side effects.
   It's called once per agent build to map `AgentConfig` → the subset
   your tool needs. Tests can exercise it in isolation.
2. **`create` returns `null` when unusable.** Missing API key, missing
   runtime hint, unsupported platform — returning `null` is the
   cleanest way to opt out. The tool just doesn't appear to the model.
3. **Throw on error.** The adapter in
   [server/tools/tool-adapter.ts](../../server/tools/tool-adapter.ts)
   turns thrown errors into structured `{status: 'error', …}` tool
   results. You don't need to catch-and-stringify yourself.

---

## What you can read at build time

Your `resolveContext(config, runtime)` receives two things. A third
layer — environment variables — is commonly read directly from
`process.env`.

**Precedence convention** when a value could come from multiple
sources: `config.whatever || process.env.WHATEVER`. Built-ins follow
this pattern consistently.

### `AgentConfig` — per-agent configuration

Defined in [shared/agent-config.ts](../../shared/agent-config.ts).
Relevant slots for user tools:

- Ad-hoc fields on the tools-node data (`config.tools` and
  `config.toolSettings`) — the UI persists whatever the user puts on
  the node, and the cast-and-read pattern above is the v1 story. When
  the per-tool schema editor ships (see
  [Open questions](#open-questions)), your tool will declare a
  `config.schema` and the Tools node will auto-render a form.
- `config.models` / `config.provider` — if your tool needs to call an
  LLM itself, prefer the same provider the agent is already using.
- Standard keys like `config.openaiApiKey` already exist on the config
  for built-ins; reuse them if your tool talks to the same service.

### `RuntimeHints` — cross-cutting runtime state

Defined in
[server/tools/tool-module.ts](../../server/tools/tool-module.ts)
(re-exported from [server/tools/sdk.ts](../../server/tools/sdk.ts)):

| Field                  | When it's present                                 |
|------------------------|---------------------------------------------------|
| `cwd`                  | Always — resolved agent workspace directory.      |
| `sandboxWorkdir`       | When the agent is sandbox-constrained.            |
| `modelId`              | When the agent has a resolved model id.           |
| `hitl`                 | When the HITL registry has been wired.            |
| `getOpenrouterApiKey`  | Lazy lookup — prefer over reading env directly.   |
| `providerWeb`          | When the connected provider exports web-search.   |

### Environment variables

`process.env.WHATEVER` is read the same way the built-ins read theirs.
This is the right layer for operator-level secrets that don't vary
per-agent.

---

## Common gotchas

**The tool doesn't appear in the picker after restart.**
Check the server startup log for a `[tool-registry]` line — a broken
default export or a name collision drops the tool with a warning.
Collisions with built-ins are logged and the user version is ignored
(built-ins always win).

**The tool appears but the model never calls it.**
Check the description. Smaller models pick between tools on
description alone. Say *when* to use it and *when not to*. The tool
name carries more signal than the description — `confirm_payment`
lands harder than `payment` with `kind: 'confirm'`.

**`create` returned `null` and I didn't notice.**
The Tools-node picker lists the module, but `null` from `create`
means the agent runtime silently drops the tool before handing it to
the model. Add a `console.log` in `create` to see why you're
returning `null`.

**TypeScript errors on ad-hoc `AgentConfig` fields.**
`AgentConfig` is permissive enough to carry your extra keys, but
TypeScript doesn't know about them. Cast at the read site:
`(config as { weatherApiKey?: string }).weatherApiKey`. The per-tool
schema editor (see [Open questions](#open-questions)) will remove
this pattern once shipped.

---

## Running with tsx vs compiled JS

`tsx` is the project's runtime ESM loader; it transpiles `.ts` on the
fly via dynamic `import()`. Ship raw `.ts` files under
`server/tools/user/` — no compile step required. Compiled `.js`
works either way.

If SAM ever ships as a standalone binary without `tsx`, the recipe
becomes "compile your tool to `.js` first" — not a concern today.

---

## Security model

- **Trust.** Any code in `server/tools/user/` (or `SAM_USER_TOOLS_DIR`)
  runs with the same privileges as the server process. There's no
  sandbox — if you don't trust the code, don't drop it in. Same trust
  model as VS Code extensions or Vim plugins: the operator owns the
  machine and vets what they install.
- **Failure mode.** A broken user tool logs an error and is skipped.
  It must not crash the server (enforced by the registry's fail-soft
  load path — `loadModulesFromFiles` with `failSoft: true` for the
  extra source).
- **Logging.** Every successfully loaded user tool is announced at
  startup so the operator can audit what ran.
- **Kill switch.** `SAM_DISABLE_USER_TOOLS=1` skips the scan entirely.
  Document this in your deployment recipe if the directory is
  world-writable.

---

## Where to look when things go wrong

| Symptom                                   | Start here                                                                                                          |
|-------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Tool not loaded                           | [server/tools/tool-registry.ts](../../server/tools/tool-registry.ts), `loadModulesFromFiles`                        |
| Directory not scanned                     | [server/tools/resolve-user-tools-dir.ts](../../server/tools/resolve-user-tools-dir.ts)                              |
| Tool not in UI picker                     | [src/store/tool-catalog-store.ts](../../src/store/tool-catalog-store.ts) (refresh the page; `GET /api/tools` reply) |
| Tool classified wrong in confirmation     | [server/tools/tool-module.ts](../../server/tools/tool-module.ts) — `classification` field                           |
| Model isn't being told the tool exists    | [src/utils/graph-to-agent.ts](../../src/utils/graph-to-agent.ts) (system-prompt summary)                            |

---

# Design notes

Architectural context for maintainers of the loader and the
extension points. Authors don't need to read this to ship a tool.

## Goal & non-goals

**Goal.** A single file dropped at a known location on disk, plus a
restart, is enough for a tool to appear:

- in the Tools node's "Individual Tools" picker,
- in the agent's runtime tool list,
- in the confirmation policy's classification buckets.

No npm publish, no rebuild of `simple-agent-manager`, no edit of any
project source file.

**Non-goals.**

- **Sandboxing untrusted code.** By design — see
  [Security model](#security-model).
- **Hot reload.** Restart-required.
- **A package registry.** "Drop a file in a directory" is the
  delivery mechanism.
- **Per-tool credential UI.** Tools inherit whatever's in
  `AgentConfig` plus `process.env`. See
  [Open questions](#open-questions) for the schema-editor follow-up.

## Loading mechanism

`initializeToolRegistry({ extraDirs })` in
[server/tools/tool-registry.ts](../../server/tools/tool-registry.ts):

- scans the directories recursively for `*.module.ts` / `*.module.js`,
- dynamically `import()`s each file,
- validates the default export looks like a `ToolModule`,
- skips broken files with a logged error rather than crashing,
- rejects user tools whose `name` collides with a built-in (built-ins
  win; the user's collision is logged and ignored).

`extraDirs` is supplied at startup by
[server/tools/resolve-user-tools-dir.ts](../../server/tools/resolve-user-tools-dir.ts),
which expands `~`, honors `SAM_USER_TOOLS_DIR` and
`SAM_DISABLE_USER_TOOLS`, and returns `{ dirs, describe }`.
[server/index.ts](../../server/index.ts) threads `dirs` through and
logs `[Tools] N built-in + M user tool(s) loaded (<describe>).` using
`getToolSourceCounts()` to split the counts.

The catalog is exposed to the frontend via `GET /api/tools`, which
calls `getToolCatalog()` on the registry and returns the shape
defined in [shared/tool-catalog.ts](../../shared/tool-catalog.ts).

## UI integration

- [server/index.ts](../../server/index.ts) exposes `GET /api/tools`.
- [src/store/tool-catalog-store.ts](../../src/store/tool-catalog-store.ts)
  fetches the endpoint on app mount (see
  [src/App.tsx](../../src/App.tsx)), exposes
  `{ tools, loaded, loading, error }`, and synthesises fallback
  entries from `ALL_TOOL_NAMES` when the backend is unreachable.
- [src/panels/property-editors/ToolsProperties.tsx](../../src/panels/property-editors/ToolsProperties.tsx)
  reads the live catalog, groups entries by `group` (known groups
  first in canonical order, user-declared groups alphabetical,
  ungrouped last), and uses each entry's `description` as the
  checkbox tooltip.
- [src/utils/graph-to-agent.ts](../../src/utils/graph-to-agent.ts)
  unions catalog-known names onto `IMPLEMENTED_TOOL_NAMES` when
  composing the system-prompt "Tools available" summary, so user
  tools get advertised to the model just like built-ins.

## Versioning / API stability

The public contract for user tools is the set of names re-exported
from [server/tools/sdk.ts](../../server/tools/sdk.ts): `defineTool`,
`ToolModule`, `ToolClassification`, `RuntimeHints`, and
`ProviderWebContext`. Internal refactors of `tool-module.ts` are
free as long as those names keep pointing at something with the
same shape — user tools only import from `sdk.ts`.

Breaking changes to the `ToolModule` interface itself need a
migration path:

- Keep the old shape supported via an adapter in `sdk.ts`, or
- Document a migration for affected tools.

The surface is small (`name`, `label`, `description`, `group`,
`classification`, `resolveContext`, `create`, optional `config`),
which gives us room to evolve without churning user code.

## Open questions

- **Per-tool config UI.** The Tools node has hand-written editors for
  built-in tools (image, TTS, music, exec, code-execution). User tools
  need either (a) a generic schema-driven editor, (b) freeform JSON,
  or (c) skip per-agent config and rely entirely on env. **Lean: (a).**
  The `ToolModule.config` field (schema + defaults) already exists on
  the interface but is not yet consumed by the UI — the registry
  endpoint exposes the schema, so the remaining work is on the
  frontend: render a form from the TypeBox schema into the Tools
  node's per-tool editor area. Until then, users rely on
  `AgentConfig` ad-hoc fields + env vars.
- **Aliases.** Built-ins can declare aliases (`bash` → `exec`). Should
  user tools? **Lean: no — forces a unique top-level name and avoids
  confusing collisions.**
- **Stable API for shared utilities.** Tools that want to call the
  storage engine, or read other agent state, need an exported API.
  **Lean: don't expose anything beyond `RuntimeHints` + `AgentConfig`
  for now; revisit when a real user request lands.**
- **Tool plugins shipped as npm packages.** The current Plugin SDK
  (`shared/plugin-sdk.ts`) is for *provider* plugins, not tool
  plugins. Raw files are the delivery mechanism; reusing the
  provider plugin-SDK machinery for tools is doable when demand
  exists.
