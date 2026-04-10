# Provider Plugin SDK Design

**Date:** 2026-04-09
**Status:** Approved

## Summary

Introduce a provider plugin SDK into SAM, enabling providers to be integrated as modular plugins. A new **Provider node** (peripheral) connects to agent nodes, owning provider identity, auth, and model catalog. The agent node retains `modelId` selection. OpenRouter ships as the first plugin. The design follows a layered architecture: shared types, server plugin host, and UI layer.

## Scope

### In scope (v1)

- Full plugin SDK pattern (`definePluginEntry` / `ProviderPluginDefinition`)
- Provider node as a new peripheral node type
- Auth: API key + env var fallback + base URL override
- Per-provider model catalog cache (shared across nodes of same provider)
- Full stream family system (stream wrappers, composition)
- Provider node owns provider identity; agent node keeps `modelId`
- Config-driven plugin loading (`providers.json`)
- Web search / web fetch contracts
- OpenRouter as first provider
- Breaking change for old graphs (no migration)

### Deferred

- OAuth / interactive login auth
- Wizard onboarding flow
- Self-hosted local model discovery
- Provider aliases
- Paired provider catalogs
- Model ID normalization
- Provider usage tracking

## Architecture

Three layers following SAM's existing `shared/` -> `server/` -> `src/` split:

1. **Core Plugin SDK** (`shared/plugin-sdk/`) - Portable type definitions and pure utility functions. No runtime logic, no Node.js or React dependencies.
2. **Server Plugin Host** (`server/providers/`) - Plugin lifecycle, registry, config-driven loading, catalog caching, stream wrapper composition.
3. **UI Layer** (`src/nodes/`, `src/panels/`) - Provider node component, property editor, catalog browser.

## Layer 1: Shared Plugin SDK (`shared/plugin-sdk/`)

### Core types (`shared/plugin-sdk/types.ts`)

```ts
/** What a provider plugin must implement */
interface ProviderPluginDefinition {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  envVars: string[];
  auth: ProviderAuthMethod[];
  catalog: ProviderPluginCatalog;
  streamFamily?: ProviderStreamFamily;
  wrapStreamFn?: (ctx: ProviderWrapStreamFnContext) => StreamFn | undefined;
  webSearch?: WebSearchProviderPlugin;
  webFetch?: WebFetchProviderPlugin;
}

interface ProviderAuthMethod {
  methodId: string;
  label: string;
  type: 'api-key';   // only api-key for v1
  envVar?: string;
  validate?: (key: string, baseUrl: string) => Promise<boolean>;
}

interface ProviderPluginCatalog {
  order: 'simple' | 'full';
  run: (ctx: ProviderCatalogContext) => Promise<ProviderCatalogResult>;
}

interface ProviderCatalogContext {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

interface ProviderCatalogResult {
  models: Record<string, DiscoveredModelMetadata>;
  userModels?: Record<string, DiscoveredModelMetadata>;
}
```

### Stream types (`shared/plugin-sdk/stream.ts`)

```ts
type ProviderStreamFamily =
  | 'openrouter-thinking'
  | 'openai-responses-defaults'
  | 'google-thinking'
  | 'tool-stream-default-on';

type ProviderStreamWrapperFactory =
  | ((streamFn: StreamFn | undefined) => StreamFn | undefined)
  | null | undefined | false;

interface ProviderWrapStreamFnContext {
  streamFn: StreamFn | undefined;
  thinkingLevel: string;
  modelId: string;
  config?: unknown;
  extraParams?: Record<string, unknown>;
}

function composeProviderStreamWrappers(
  base: StreamFn | undefined,
  ...wrappers: ProviderStreamWrapperFactory[]
): StreamFn | undefined;
```

### Web contracts (`shared/plugin-sdk/web-contracts.ts`)

```ts
interface WebSearchToolContext {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

interface WebFetchToolContext {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

interface WebSearchProviderPlugin {
  id: string;
  label: string;
  createTool: (ctx: WebSearchToolContext) => AgentTool;
}

interface WebFetchProviderPlugin {
  id: string;
  label: string;
  createTool: (ctx: WebFetchToolContext) => AgentTool;
}
```

### Resolved config (added to `shared/agent-config.ts`)

```ts
interface ResolvedProviderConfig {
  pluginId: string;
  baseUrl: string;    // node's override value; '' = server fills in plugin defaultBaseUrl at runtime
  envVar: string;
  // apiKey is NOT serialized — resolved at runtime by the server
}
```

The existing `provider: string` field on `AgentConfig` becomes `provider: ResolvedProviderConfig`. `modelId` stays as-is.

Note: `graph-to-agent.ts` runs in the browser and does not have access to the server-side plugin registry. It passes the node's raw `baseUrl` override (possibly empty). The server resolves the actual URL at runtime: `config.provider.baseUrl || plugin.defaultBaseUrl`.

## Layer 2: Server Plugin Host (`server/providers/`)

### Plugin Registry (`server/providers/plugin-registry.ts`)

```ts
class ProviderPluginRegistry {
  private plugins: Map<string, ProviderPluginDefinition> = new Map();

  register(plugin: ProviderPluginDefinition): void;
  get(pluginId: string): ProviderPluginDefinition | undefined;
  list(): ProviderPluginDefinition[];
  has(pluginId: string): boolean;
}
```

### Config-driven loading (`server/providers/provider-loader.ts`)

Reads a config file (e.g. `providers.json` in the storage/settings directory):

```json
{
  "providers": [
    { "id": "openrouter", "enabled": true },
    { "id": "anthropic",  "enabled": false }
  ]
}
```

Each `id` maps to a file: `server/providers/plugins/<id>.ts`. The loader imports each enabled plugin and registers it with the `ProviderPluginRegistry`.

```ts
function loadProviderPlugins(
  configPath: string,
  registry: ProviderPluginRegistry
): Promise<void>;
```

### Per-provider catalog cache (`server/providers/catalog-cache.ts`)

All Provider nodes with the same `pluginId` share one cached catalog. Keyed by `pluginId`. Tracks the API key fingerprint of the last sync; flags `userModelsRequireRefresh` when the key doesn't match.

```ts
class ProviderCatalogCache {
  private catalogs: Map<string, PersistedProviderCatalog> = new Map();

  async load(pluginId: string, apiKeyFingerprint?: string): Promise<ProviderCatalogResponse | null>;
  async refresh(
    pluginId: string,
    plugin: ProviderPluginDefinition,
    ctx: ProviderCatalogContext
  ): Promise<ProviderCatalogResponse>;
  async clear(pluginId: string): Promise<void>;
}
```

Replaces `OpenRouterModelCatalogStore`.

### Stream resolver (`server/providers/stream-resolver.ts`)

```ts
function resolveProviderStreamFn(
  plugin: ProviderPluginDefinition,
  ctx: ProviderWrapStreamFnContext
): StreamFn | undefined;
```

Resolution order:
1. Start with base `StreamFn` from `pi-agent-core`
2. If plugin has a `streamFamily`, apply `buildProviderStreamFamilyHooks()`
3. If plugin has a custom `wrapStreamFn`, apply it
4. Return composed `StreamFn`

### OpenRouter plugin (`server/providers/plugins/openrouter.ts`)

Reference implementation:

- `id: 'openrouter'`
- `defaultBaseUrl: 'https://openrouter.ai/api/v1'`
- `envVars: ['OPENROUTER_API_KEY']`
- `auth`: single api-key method with optional validate (HEAD to `/models`)
- `catalog.run`: migrated from `OpenRouterModelCatalogStore.refresh()`
- `streamFamily: 'openrouter-thinking'`
- `wrapStreamFn`: composes OpenRouter thinking wrapper + HTML entity decoding
- `webSearch`: tool leveraging OpenRouter's `:online` model suffix or provider params
- `webFetch`: tool for URL content fetching through provider capabilities

## Layer 3: UI Layer

### Provider node (`src/nodes/ProviderNode.tsx`)

New peripheral node type. Connects to agent nodes like memory/tools/storage.

```ts
interface ProviderNodeData {
  [key: string]: unknown;
  type: 'provider';
  label: string;
  pluginId: string;
  apiKey: string;
  envVar: string;
  baseUrl: string;             // optional override; '' = use plugin default
  catalogModels: string[];
  catalogSyncedAt: string | null;
}
```

Default values for OpenRouter:
- `pluginId: 'openrouter'`
- `apiKey: ''`
- `envVar: 'OPENROUTER_API_KEY'`
- `baseUrl: ''` (uses plugin's `defaultBaseUrl: 'https://openrouter.ai/api/v1'`)
- `catalogModels: []`
- `catalogSyncedAt: null`

### Agent node changes

- Remove `provider` field from `AgentNodeData`
- Keep `modelId` — selected from the connected Provider node's catalog
- Agent property editor model picker is populated from the connected Provider node's `catalogModels`

### Model catalog store changes

`src/store/model-catalog-store.ts` generalizes from hardcoded `openrouter` to `pluginId`-keyed state. Routes change from `/api/model-catalog/openrouter` to `/api/providers/:pluginId/catalog`.

## Integration Points

### Graph resolution (`src/utils/graph-to-agent.ts`)

- Finds connected Provider node for the agent
- Reads `pluginId`, resolves auth (apiKey > envVar), resolves baseUrl (node override > plugin default)
- Builds `ResolvedProviderConfig` on `AgentConfig`
- Agent without a connected Provider node: `resolveAgentConfig()` returns `null`

### Agent runtime (`server/runtime/agent-runtime.ts`)

- Reads `config.provider.pluginId`, looks up plugin from `ProviderPluginRegistry`
- Calls `resolveProviderStreamFn(plugin, ctx)` for the composed `StreamFn`
- Passes `config.provider.baseUrl` when constructing API calls

### Tool factory (`server/runtime/tool-factory.ts`)

- Checks resolved provider config for `webSearch` / `webFetch` contracts
- Injects web contract tools into the agent's available tools automatically
- Tools node doesn't need to know about providers; injection is server-side

### Model resolver (`server/runtime/model-resolver.ts`)

- Accepts `ResolvedProviderConfig` instead of bare `provider: string`
- Uses `pluginId` for model lookup

## File Changes

### Files to create

| File | Purpose |
|------|---------|
| `shared/plugin-sdk/types.ts` | Core plugin type definitions |
| `shared/plugin-sdk/stream.ts` | Stream wrapper types + `composeProviderStreamWrappers` |
| `shared/plugin-sdk/web-contracts.ts` | WebSearch/WebFetch plugin contracts |
| `shared/plugin-sdk/index.ts` | Barrel export |
| `server/providers/plugin-registry.ts` | Registry class |
| `server/providers/provider-loader.ts` | Config-driven plugin loading |
| `server/providers/catalog-cache.ts` | Per-provider catalog cache |
| `server/providers/stream-resolver.ts` | Stream function resolution |
| `server/providers/plugins/openrouter.ts` | OpenRouter plugin definition |
| `src/nodes/ProviderNode.tsx` | Provider node UI component |
| `src/panels/property-editors/ProviderEditor.tsx` | Property editor for Provider node |

### Files to modify

| File | Change |
|------|--------|
| `src/types/nodes.ts` | Add `'provider'` to `NodeType`, add `ProviderNodeData`, add to union, remove `provider` from `AgentNodeData` |
| `shared/agent-config.ts` | Add `ResolvedProviderConfig`, change `provider` field type on `AgentConfig` |
| `src/utils/graph-to-agent.ts` | Add Provider node resolution, require connected provider |
| `src/utils/default-nodes.ts` | Add `'provider'` case |
| `src/nodes/node-registry.ts` | Add `provider: ProviderNode` |
| `src/store/model-catalog-store.ts` | Generalize to `pluginId`-keyed state, update routes |
| `server/runtime/model-resolver.ts` | Accept `ResolvedProviderConfig` |
| `server/runtime/agent-runtime.ts` | Resolve stream through plugin registry |
| `server/runtime/tool-factory.ts` | Inject web contract tools from provider |
| `server/index.ts` | Init registry + cache, replace hardcoded routes, load plugins from config |
| `server/auth/api-keys.ts` | No structural change |

### Files to delete

| File | Reason |
|------|--------|
| `server/runtime/openrouter-model-catalog-store.ts` | Replaced by `catalog-cache.ts` + `openrouter.ts` plugin |
| `server/runtime/openrouter-model-catalog-store.test.ts` | Tests move to new locations |

## Breaking Changes

Existing saved graphs with `provider` on the agent node will fail to resolve. Users must add a Provider node and connect it. No migration path provided intentionally.
