# Adding a new tool

<!-- last-verified: 2026-04-18 -->

This guide walks through adding a new tool to SAM end-to-end using a hypothetical `weather` tool as the running example. If `weather` sounds too generic, mentally substitute whichever tool you're actually building.

Two paths are documented:

1. **Today's process** (legacy) — touches 5–9 files. Use this until the `ToolModule` redesign (see [tool-module-pattern.md](./tool-module-pattern.md)) lands for every tool.
2. **`ToolModule` path** (recommended going forward) — one file per tool. Only available for tools that already went through the migration. Currently: `calculator`, `ask_user`, `confirm_action`.

If the tool is trivial (no config, no auth), prefer the `ToolModule` path.

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

Tips that apply to every tool regardless of path:

- **Name clarity trumps description.** Small models ignore descriptions. `confirm_action` lands harder than `ask_user` with `kind: 'confirm'`.
- **Be specific in the description.** State WHEN to use it, WHEN NOT to use it, and what the output looks like. Smaller models lean on this to pick the right tool.
- **Validate at boundaries.** `params` is typed `any` at the execute signature — the schema enforces at the provider level, but don't assume well-formed input.
- **Respect the abort signal.** Long-running tools should pass `signal` to their `fetch` calls and abort on `signal.aborted`.
- **Errors become tool results.** The adapter in [server/tools/tool-adapter.ts](../../server/tools/tool-adapter.ts) turns thrown errors into structured `{status:'error', ...}` results. You can throw freely.

---

## Path 1 — Today's process (legacy)

Example: adding a `weather` tool that takes a city and returns current conditions via an external API.

### 1. Write the tool

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

Colocate `weather.test.ts` next to it. Standard shape:

```ts
import { describe, expect, it } from 'vitest';
import { createWeatherTool } from './weather';

describe('weather tool', () => {
  it('throws when apiKey missing', async () => {
    const tool = createWeatherTool({});
    await expect(
      tool.execute('id', { city: 'Madrid' }, new AbortController().signal),
    ).rejects.toThrow(/API key/);
  });
});
```

### 2. Register the tool name (3 shared lists)

Open [shared/resolve-tool-names.ts](../../shared/resolve-tool-names.ts):

- `TOOL_GROUPS` — add `'weather'` to the appropriate group (e.g. `web`). Create a new group only if nothing fits.
- `ALL_TOOL_NAMES` — append `'weather'`.
- `IMPLEMENTED_TOOL_NAMES` — append `'weather'`. If omitted, the system-prompt summary won't advertise the tool.

### 3. Thread configuration through the factory

Open [server/tools/tool-factory.ts](../../server/tools/tool-factory.ts):

- Add `import { createWeatherTool } from './builtins/weather/weather';` at the top.
- Add a field to `ToolFactoryContext`:
  ```ts
  /** OpenWeather (or similar) API key for the weather tool */
  weatherApiKey?: string;
  ```
- Add a branch inside `createAgentTools()`'s loop:
  ```ts
  if (name === 'weather' && factoryContext?.weatherApiKey) {
    tools.push(createWeatherTool({ apiKey: factoryContext.weatherApiKey }));
    continue;
  }
  ```

### 4. Propagate the config from AgentConfig → factory

Open [shared/agent-config.ts](../../shared/agent-config.ts) and add `weatherApiKey?: string;` to `AgentConfig`.

Open [server/runtime/agent-runtime.ts](../../server/runtime/agent-runtime.ts) and thread the value into the `createAgentTools` call:

```ts
const weatherApiKey = config.weatherApiKey || process.env.WEATHER_API_KEY;
// ...
let tools = createAgentTools(toolNames, memoryTools, undefined, {
  // ... existing fields ...
  weatherApiKey,
});
```

### 5. UI config (only if the tool has settings)

If the tool needs per-agent user-entered config:

- [src/types/nodes.ts](../../src/types/nodes.ts) — add `WeatherToolSettings { apiKey: string; skill: string }` to `ToolSettings`.
- [src/utils/default-nodes.ts](../../src/utils/default-nodes.ts) — add the `weather: { apiKey: '', skill: '' }` default under the `tools` case's `toolSettings`.
- [src/panels/property-editors/ToolsProperties.tsx](../../src/panels/property-editors/ToolsProperties.tsx) — add a `PageLink`, a page component, and handlers. Bring in a lucide icon.
- [src/utils/graph-to-agent.ts](../../src/utils/graph-to-agent.ts) — copy `toolsNode.data.toolSettings?.weather?.apiKey` into `AgentConfig.weatherApiKey`.

### 6. Verify

```
npx tsc --noEmit
npx vitest run server/tools/builtins/weather shared/resolve-tool-names
```

### Why this hurts

Step 2, step 3, and step 5 all edit centralized registries and switch statements. Every new tool branch hits the same conflict lines. See the `ToolModule` pattern below for the fix.

---

## Path 2 — `ToolModule` pattern (recommended going forward)

One file per tool, no central switch statements. The tool declares everything about itself and gets discovered at boot.

### 1. Write the module

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

  // Optional: if the tool has per-agent config that should show up in
  // the Tools node's "Individual Tools" panel.
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

`create` may return `null` to indicate the tool isn't available for this config (missing auth, disabled capability, etc.). The factory skips nulls cleanly.

### 2. Register it — one line

Open [server/tools/tool-registry.ts](../../server/tools/tool-registry.ts) and add the import + push a default into `TOOL_MODULES`:

```ts
import weatherModule from './builtins/weather/weather.module';

export const TOOL_MODULES: ToolModule[] = [
  // existing…
  weatherModule,
];
```

That's the *only* registry edit. Name, group, description, config, and wiring all live in `weather.module.ts`. Future revisions ([tool-module-pattern.md](./tool-module-pattern.md) tracks this) will move to filesystem scanning so even this one line goes away.

### 3. Tests

Same pattern as Path 1 — colocate `weather.module.test.ts` that asserts `.default.name === 'weather'`, that `resolveContext` returns what you expect, and that `create` produces a valid `AgentTool`.

### 4. Verify

```
npx tsc --noEmit
npx vitest run server/tools/builtins/weather server/tools/tool-registry
```

---

## Choosing a classification

The optional `classification` field on `ToolModule` tells the HITL system whether a tool needs `confirm_action` by default:

- `read-only` — `web_search`, `calculator`, `read_file`, `list_directory`. No state change on the user's system or remote services.
- `state-mutating` — `write_file`, `edit_file`, `image_generate` (writes a file to disk), `send_message`. Reversible or scoped side effects.
- `destructive` — `exec`, `bash`, `apply_patch`, operations with `rm`/`DELETE` semantics. Hard or impossible to undo.

The `agent-runtime` builder groups each agent's enabled tools by classification and appends a "Tool confirmation matrix" block to the system prompt right after the user-editable policy text. The matrix tells the model which of ITS tools are read-only (no confirmation), state-mutating (confirm first), and destructive (confirm with explicit impact summary). Tools not in the `ToolModule` registry (memory, session tools, provider-plugin tools) get conservative defaults via a fallback map in [classification-policy.ts](../../server/tools/classification-policy.ts).

---

## Troubleshooting

- **Model calls the tool without confirming first.** The `ask_user` / `confirm_action` tools must be in the resolved tool list. They're force-injected by [agent-runtime.ts](../../server/runtime/agent-runtime.ts) when `safety.allowDisableHitl === false`. If you see bypass on a newly created agent, check `settings.json` for `safety.allowDisableHitl: true`.
- **Tool shows up in the Tools node UI but never executes.** Check that `IMPLEMENTED_TOOL_NAMES` includes the tool — that set gates both the UI picker AND the factory's recognition of the name.
- **Gemini rejects the tool's schema.** The adapter ([server/tools/tool-adapter.ts](../../server/tools/tool-adapter.ts)) strips unsupported JSON Schema features (`anyOf`, `format`, etc.) for Gemini models. If a new feature is rejected, add it to `cleanSchemaForGemini`.
- **Tool timeout is too short.** Tools that rely on external APIs should respect the agent's abort signal; otherwise a run abort leaks a pending request. Pass `{ signal }` to `fetch`.

---

## Related

- [tool-module-pattern.md](./tool-module-pattern.md) — architecture notes on the `ToolModule` interface and the migration path.
- [server/tools/tool-adapter.ts](../../server/tools/tool-adapter.ts) — shared adapter that normalizes tool errors and cleans schemas.
- [shared/resolve-tool-names.ts](../../shared/resolve-tool-names.ts) — tool groups, `ALL_TOOL_NAMES`, `IMPLEMENTED_TOOL_NAMES`. (Path 1 edit surface.)
- [server/tools/tool-factory.ts](../../server/tools/tool-factory.ts) — the runtime assembly point. (Path 1 edit surface.)
- [server/tools/tool-registry.ts](../../server/tools/tool-registry.ts) — the `ToolModule` registry. (Path 2 edit surface.)
