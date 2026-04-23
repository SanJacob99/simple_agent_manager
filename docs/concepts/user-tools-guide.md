# User-Installed Tools — Author's Guide

<!-- last-verified: 2026-04-23 -->

This guide is for **power users who want to extend their SAM install
without forking**. Drop a `*.module.ts` file under `server/tools/user/`,
restart the server, and your tool shows up in the Tools node picker
alongside the built-ins.

For the general tool-authoring anatomy (what an `AgentTool` is, how
execute-results flow back to the model, how the safety classification
is used), read [adding-a-tool.md](./adding-a-tool.md) first. This page
covers only the user-install path on top of that.

Architecture / roadmap: [user-tools-plan.md](./user-tools-plan.md).

---

## Quick start

```bash
npm run scaffold:tool -- weather
# created server/tools/user/weather/weather.module.ts
# edit the file, restart the server, enable it in the Tools node.
```

The scaffold script validates the name (snake_case, no built-in
collision), creates the directory, and writes a minimal runnable
`ToolModule` you can iterate on.

---

## Where tools live

- Default: `server/tools/user/<name>/<name>.module.ts`. This directory
  is created on demand and is gitignored — `git pull` on the main
  repo will never touch what you drop in here.
- Override the directory: `SAM_USER_TOOLS_DIR=/some/absolute/path`.
  Useful for a shared team library on disk. A leading `~/` expands to
  your home directory.
- Kill switch: `SAM_DISABLE_USER_TOOLS=1` — production containers or
  CI that should never load local extras.

Implementation: [server/tools/resolve-user-tools-dir.ts](../../server/tools/resolve-user-tools-dir.ts).
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
ship with a documented migration path.

When the M4 npm package lands, `sdk.ts` will be replaced by an
`@simple-agent-manager/tool-sdk` import and the rest of your code
won't need to change.

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
  // key in shared/resolve-tool-names.ts#TOOL_GROUPS, otherwise the
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

Your `resolveContext(config, runtime)` receives two things.

### `AgentConfig` — per-agent configuration

Defined in [shared/agent-config.ts](../../shared/agent-config.ts).
Relevant slots for user tools:

- Ad-hoc fields on the tools-node data (`config.tools` and
  `config.toolSettings`) — the UI persists whatever the user puts on
  the node, and the cast-and-read pattern above is the v1 story. When
  the per-tool schema editor ships (see
  [user-tools-plan.md § Open questions](./user-tools-plan.md#open-questions)),
  your tool will declare a `config.schema` and the Tools node will
  auto-render a form.
- `config.models` / `config.provider` — if your tool needs to call an
  LLM itself, prefer the same provider the agent is already using.
- Standard keys like `config.openaiApiKey` already exist on the config
  for built-ins; reuse them if your tool talks to the same service.

### `RuntimeHints` — cross-cutting runtime state

Defined in [server/tools/tool-module.ts](../../server/tools/tool-module.ts)
(re-exported from [server/tools/sdk.ts](../../server/tools/sdk.ts)):

| Field                  | When it's present                                 |
|------------------------|---------------------------------------------------|
| `cwd`                  | Always — resolved agent workspace directory.      |
| `sandboxWorkdir`       | When the agent is sandbox-constrained.            |
| `modelId`              | When the agent has a resolved model id.           |
| `hitl`                 | When the HITL registry has been wired.            |
| `getOpenrouterApiKey`  | Lazy lookup — prefer over reading env directly.   |
| `providerWeb`          | When the connected provider exports web-search.   |

Environment variables are also fair game: `process.env.WHATEVER` is
read the same way the built-ins read theirs. Precedence is
conventional: `config.whatever || process.env.WHATEVER`.

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
`(config as { weatherApiKey?: string }).weatherApiKey`. When M2's
per-tool schema editor lands this goes away.

---

## Running with tsx vs compiled JS

The dev server launches with `tsx`, which transpiles `.ts` on the fly.
Ship raw `.ts` files under `server/tools/user/` — no compile step
required. If you ever build a standalone binary without `tsx`,
compile to `.js` and put the compiled files in the same directory.

---

## Security model (the short version)

- User tools run with the same privileges as the server process.
  There's no sandbox — if you don't trust the code, don't drop it in.
- A broken user tool is logged and skipped. It must not crash the
  server (enforced by the registry's fail-soft load path).
- Every successful load is announced at startup with the file path
  so you can audit what ran.
- `SAM_DISABLE_USER_TOOLS=1` skips the scan entirely. Document this
  in your deployment recipe if the directory is world-writable.

Full model: [user-tools-plan.md § Security model](./user-tools-plan.md#security-model).

---

## Where to look when things go wrong

| Symptom                                   | Start here                                                                                                          |
|-------------------------------------------|---------------------------------------------------------------------------------------------------------------------|
| Tool not loaded                           | [server/tools/tool-registry.ts](../../server/tools/tool-registry.ts), `loadModulesFromFiles`                        |
| Directory not scanned                     | [server/tools/resolve-user-tools-dir.ts](../../server/tools/resolve-user-tools-dir.ts)                              |
| Tool not in UI picker                     | [src/store/tool-catalog-store.ts](../../src/store/tool-catalog-store.ts) (refresh the page; `GET /api/tools` reply) |
| Tool classified wrong in confirmation     | [server/tools/tool-module.ts](../../server/tools/tool-module.ts) — `classification` field                           |
| Model isn't being told the tool exists    | [src/utils/graph-to-agent.ts](../../src/utils/graph-to-agent.ts) (system-prompt summary)                            |
