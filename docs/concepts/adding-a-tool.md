# Authoring a Tool

<!-- last-verified: 2026-04-23 -->

This guide walks through adding a new tool to SAM end-to-end using a hypothetical `weather` tool as the running example. If `weather` sounds too generic, mentally substitute whichever tool you're actually building.

There are two audiences:

- **Developers extending the SAM codebase.** Drop a `*.module.ts` file under `server/tools/builtins/`. That is [the single-file path](#single-file-path-toolmodule) below.
- **Power users who want to add tools to their own SAM install without forking.** Drop a `*.module.ts` file under `server/tools/user/` — the loader picks it up at startup. Start with [the user-tools guide](./user-tools-guide.md), which has the scaffold command, a worked `weather` example, and the stable import surface you should use.

If you have never written a tool for SAM before, read [Anatomy of a tool](#anatomy-of-a-tool) first.

---

## Anatomy of a tool

Every tool ultimately produces an `AgentTool<TSchema>` object from `@mariozechner/pi-agent-core`:

```ts
{
  name: string;                         // snake_case, must be unique
  label: string;                        // human display
  description: string;                  // the model reads this — be specific
  parameters: TSchema;                  // TypeBox schema
  execute: (toolCallId, params, signal) => Promise<AgentToolResult>;
}
```

The `execute` function returns an `AgentToolResult`:

```ts
{
  content: Array<{ type: 'text' | 'image', text?, mimeType?, data? }>;
  details?: unknown;   // machine-readable summary — powers isError derivation etc.
}
```

Tips that apply to every tool:

- **Name clarity trumps description.** Small models ignore descriptions. `confirm_action` lands harder than `ask_user` with `kind: 'confirm'`.
- **Be specific in the description.** State WHEN to use it, WHEN NOT to use it, and what the output looks like. Smaller models lean on this to pick the right tool.
- **Validate at boundaries.** `params` is typed `any` at the execute signature — the schema enforces at the provider level, but don't assume well-formed input.
- **Respect the abort signal.** Long-running tools should pass `signal` to their `fetch` calls and abort on `signal.aborted`.
- **Errors become tool results.** The adapter in [server/tools/tool-adapter.ts](../../server/tools/tool-adapter.ts) turns thrown errors into structured `{status:'error', ...}` results. You can throw freely.

---

## Single-file path (`ToolModule`)

This is the only path you should use for new tools. One file per tool, no central switch statements. The tool declares everything about itself and gets discovered at boot by the filesystem scan in [server/tools/tool-registry.ts](../../server/tools/tool-registry.ts).

Every built-in tool currently ships this way — see `server/tools/builtins/*/*.module.ts` for live references.

### 1. Write the implementation

Create [server/tools/builtins/weather/weather.ts](../../server/tools/builtins/weather/weather.ts):

```ts
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

export interface WeatherContext {
  apiKey?: string;
}

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

export function createWeatherTool(ctx: WeatherContext): AgentTool<TSchema> {
  return {
    name: 'weather',
    label: 'Weather',
    description:
      'Fetch current weather for a city. Read-only, returns temperature and conditions. ' +
      'Use when the user asks about current weather. Do NOT use for forecasts beyond today.',
    parameters: Type.Object({
      city: Type.String({ description: 'City name, e.g. "Barcelona" or "San Francisco, CA"' }),
    }),
    execute: async (_toolCallId, params: any, signal) => {
      if (!ctx.apiKey) throw new Error('Weather API key not configured');
      const city = (params.city as string)?.trim();
      if (!city) throw new Error('city is required');
      const res = await fetch(
        `https://api.weatherexample.com/current?city=${encodeURIComponent(city)}&key=${ctx.apiKey}`,
        { signal },
      );
      if (!res.ok) throw new Error(`weather API ${res.status}`);
      const data = await res.json() as { tempF: number; conditions: string };
      return textResult(`${data.tempF}°F, ${data.conditions} in ${city}`);
    },
  };
}
```

### 2. Write the module

Create [server/tools/builtins/weather/weather.module.ts](../../server/tools/builtins/weather/weather.module.ts):

```ts
import { Type } from '@sinclair/typebox';
import { defineTool } from '../../tool-module';
import { createWeatherTool } from './weather';

export default defineTool({
  name: 'weather',
  group: 'web',
  label: 'Weather',
  description: 'Fetch current weather for a city',
  classification: 'read-only',

  // Optional: per-agent config that should show up in the Tools node's
  // "Individual Tools" panel. Simple tools (calculator, read_file) omit
  // this entirely.
  config: {
    schema: Type.Object({
      apiKey: Type.String({ title: 'API key', format: 'password' }),
      skill: Type.String({ title: 'Skill guidance', format: 'markdown' }),
    }),
    defaults: { apiKey: '', skill: '' },
  },

  resolveContext: (config) => ({
    apiKey: config.weatherApiKey || process.env.WEATHER_API_KEY,
  }),

  create: (ctx) => (ctx.apiKey ? createWeatherTool({ apiKey: ctx.apiKey }) : null),
});
```

`create` may return `null` to indicate the tool is not available for this agent's config (missing auth, disabled capability, etc.). The factory skips nulls cleanly so partially-configured agents don't advertise broken tools to the model.

### 3. Register the name — nothing to do

The filesystem scan in `tool-registry.ts` auto-loads every `*.module.ts` under `server/tools/builtins/`. Drop the file and the module is live on the next server start. There is no barrel import, no central switch, no entry in a names array.

### 4. Tests

Colocate `weather.test.ts` and `weather.module.test.ts` next to their sources. Typical shape:

```ts
import { describe, expect, it } from 'vitest';
import { createWeatherTool } from './weather';
import weatherModule from './weather.module';

describe('weather tool', () => {
  it('throws when apiKey missing', async () => {
    const tool = createWeatherTool({});
    await expect(
      tool.execute('id', { city: 'Madrid' }, new AbortController().signal),
    ).rejects.toThrow(/API key/);
  });

  it('module returns null when no key is configured', () => {
    const ctx = weatherModule.resolveContext({} as any, { cwd: '/tmp' });
    expect(weatherModule.create(ctx, { cwd: '/tmp' })).toBeNull();
  });
});
```

### 5. Verify

```
npx tsc --noEmit
npx vitest run server/tools/builtins/weather server/tools/tool-registry
```

### 6. UI config (only if the tool has per-agent settings)

The `config.schema` field on `ToolModule` is informational today — the Tools node still has hand-written editors per tool. Until the schema-driven UI lands, adding a user-facing config editor also requires:

- [src/types/nodes.ts](../../src/types/nodes.ts) — add `WeatherToolSettings { apiKey: string; skill: string }` to `ToolSettings`.
- [src/utils/default-nodes.ts](../../src/utils/default-nodes.ts) — add the `weather: { apiKey: '', skill: '' }` default under the `tools` case's `toolSettings`.
- [src/panels/property-editors/ToolsProperties.tsx](../../src/panels/property-editors/ToolsProperties.tsx) — add a `PageLink`, a page component, and handlers. Bring in a Lucide icon.
- [src/utils/graph-to-agent.ts](../../src/utils/graph-to-agent.ts) — copy `toolsNode.data.toolSettings?.weather?.apiKey` into `AgentConfig.weatherApiKey`.
- [shared/agent-config.ts](../../shared/agent-config.ts) — add `weatherApiKey?: string;` to `AgentConfig`.

If the tool only needs environment-variable config, skip this step entirely — `process.env.WEATHER_API_KEY` inside `resolveContext` is enough.

---

## Choosing a classification

The optional `classification` field on `ToolModule` tells the HITL system whether a tool needs `confirm_action` by default:

- `read-only` — `web_search`, `calculator`, `read_file`, `list_directory`. No state change on the user's system or remote services.
- `state-mutating` — `write_file`, `edit_file`, `image_generate` (writes a file to disk), `send_message`. Reversible or scoped side effects.
- `destructive` — `exec`, `bash`, `apply_patch`, operations with `rm`/`DELETE` semantics. Hard or impossible to undo.

The confirmation policy is class-aware. `read-only` tools may be called without prior confirmation; `state-mutating` tools require a `confirm_action` in a dedicated turn; `destructive` tools require a `confirm_action` whose question names the specific target. The policy template lives in [server/storage/settings-file-store.ts](../../server/storage/settings-file-store.ts) and is filled per-agent at prompt-build time using the resolved tool list (see `groupToolsByClassification` in [tool-registry.ts](../../server/tools/tool-registry.ts)).

The default when `classification` is omitted is `state-mutating` — conservative so forgetting the field cannot silently auto-confirm a dangerous tool.

---

## User-installed tools

"User-installed" means a SAM operator adds a tool to their own install without editing the main codebase or publishing a package. The file format is identical to a built-in — same `ToolModule` interface, same `defineTool` import — but the file lives in a separate directory and imports from the vendored [server/tools/sdk.ts](../../server/tools/sdk.ts) for stability.

The flow:

1. `npm run scaffold:tool -- weather` (or manually create `server/tools/user/<name>/<name>.module.ts` / at `SAM_USER_TOOLS_DIR`).
2. Edit the generated file — `export default defineTool({ ... })`, importing from `'../../sdk'`.
3. Restart the server.
4. Open the Tools node, find the tool under its declared `group`, enable it.

The [user-tools guide](./user-tools-guide.md) has a fully worked `weather` example, the complete list of what you can read from `AgentConfig` and `RuntimeHints`, and troubleshooting.

User tools run with the same privileges as the server process. There is no sandboxing — the operator owns the machine and vets what they install, same trust model as VS Code extensions or Vim plugins. A broken user module logs an error and is skipped; it does not crash the server.

Kill switch: `SAM_DISABLE_USER_TOOLS=1` skips the scan entirely. Use in CI or production containers that must not honor a user-tools directory.

---

## Troubleshooting

- **Tool doesn't appear in the Tools node UI.** The picker reads the live catalog served by `GET /api/tools` via [src/store/tool-catalog-store.ts](../../src/store/tool-catalog-store.ts). If your module loaded (`[Tools] … user tool(s) loaded` in the server log), a hard refresh should show it. If it didn't load, check the server log for a `[tool-registry]` line identifying the reason.
- **Model calls the tool without confirming first.** The `ask_user` / `confirm_action` tools must be in the resolved tool list. They are force-injected by [agent-runtime.ts](../../server/runtime/agent-runtime.ts) when `safety.allowDisableHitl === false`. If you see bypass on a newly created agent, check `settings.json` for `safety.allowDisableHitl: true`.
- **`create` returns null so the tool is invisible at runtime.** Intentional when config is missing, but easy to trip over. Log at construction time (`console.warn('[weather] skipped: no API key')`) if you want a boot-time hint.
- **Gemini rejects the tool's schema.** The adapter ([server/tools/tool-adapter.ts](../../server/tools/tool-adapter.ts)) strips unsupported JSON Schema features (`anyOf`, `format`, etc.) for Gemini models. If a new feature is rejected, add it to `cleanSchemaForGemini`.
- **Tool timeout is too short.** Tools that rely on external APIs should respect the agent's abort signal; otherwise a run abort leaks a pending request. Pass `{ signal }` to `fetch`.
- **Aliases.** `bash` → `exec` is the only alias today. New tools should pick a unique top-level name rather than declaring an alias.

---

## Legacy path (historical)

Before the `ToolModule` migration, adding a tool touched 5–9 files: the implementation plus edits to `TOOL_GROUPS`, `ALL_TOOL_NAMES`, and `IMPLEMENTED_TOOL_NAMES` in [shared/resolve-tool-names.ts](../../shared/resolve-tool-names.ts), a branch in `createAgentTools()` in [server/tools/tool-factory.ts](../../server/tools/tool-factory.ts), a field on `ToolFactoryContext`, a field on `AgentConfig`, plus the UI wiring. All built-in tools now live in `ToolModule`s; the legacy fallback path in the factory still exists but only serves `calculator` (which has a real implementation but no module yet). Do not add new tools through the legacy path — the effort is the same as writing a module, the ergonomics are worse, and the factory branch is on its way out.

---

## Related

- [server/tools/tool-module.ts](../../server/tools/tool-module.ts) — the `ToolModule`, `ToolClassification`, `RuntimeHints`, and `defineTool` definitions.
- [server/tools/tool-registry.ts](../../server/tools/tool-registry.ts) — filesystem scan, module loading, name collision handling.
- [server/tools/tool-factory.ts](../../server/tools/tool-factory.ts) — the runtime assembly point. Registry-first; legacy `TOOL_CREATORS` fallback.
- [server/tools/tool-adapter.ts](../../server/tools/tool-adapter.ts) — shared adapter that normalizes tool errors and cleans schemas.
- [shared/resolve-tool-names.ts](../../shared/resolve-tool-names.ts) — tool groups, `ALL_TOOL_NAMES`, `IMPLEMENTED_TOOL_NAMES`.
- [user-tools-guide.md](./user-tools-guide.md) — author's guide and architectural reference for drop-a-file user-installed tools (scaffold, worked example, SDK surface, troubleshooting, design notes, open questions).
- [tool-node.md](./tool-node.md) — the Tools Node that selects which tools an agent can use.
