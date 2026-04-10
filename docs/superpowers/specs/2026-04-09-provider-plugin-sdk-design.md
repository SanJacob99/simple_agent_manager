# Provider Plugin SDK Design

**Date:** 2026-04-09
**Status:** Approved (revised for implementation)

## Summary

Introduce a provider plugin SDK into SAM so model providers can be integrated as modular plugins. A new **Provider node** (peripheral) connects to agent nodes and owns provider identity, auth selection, base URL override, and catalog access. The agent node keeps `modelId`, `thinkingLevel`, and model capability overrides.

Implementation correction: raw API keys do **not** live in graph data or Provider node data. Provider nodes persist only auth references (for example, auth method + env var name + base URL override). The server resolves the actual secret at runtime from saved settings or environment variables.

OpenRouter ships as the first plugin. The design still follows SAM's `shared/` -> `server/` -> `src/` split, but the implementation must also cover settings, validation UX, tests, fixtures, and concept docs.

## Scope

### In scope (v1)

- Full plugin SDK pattern (`definePluginEntry` + `ProviderPluginDefinition`)
- Provider node as a new peripheral node type
- Auth reference model: saved API key + env var fallback + base URL override
- Server-exposed provider registry metadata for the UI
- Per-provider-instance model catalog cache
  - Cache key is `pluginId + normalized baseUrl`, not just `pluginId`
- Full stream family system (stream wrappers, composition)
- Provider node owns provider identity; agent node keeps `modelId`
- Config-driven plugin loading (`providers.json`)
- Provider-aware replacement of `web_search` / `web_fetch` implementations
- OpenRouter as the first provider
- Breaking graph/schema change for old graphs (no automatic graph migration)
- Required settings, docs, fixture, and test updates caused by the schema change

### Deferred

- Inline per-node API keys persisted in graph data
- OAuth / interactive login auth
- Hot reloading provider enablement without restarting the backend
- Wizard onboarding flow
- Self-hosted local model discovery
- Provider aliases
- Paired provider catalogs
- Model ID normalization
- Provider usage tracking

## Implementation Constraints

These are the main corrections from the first draft and must be treated as hard requirements during implementation:

- Do not persist raw API keys on Provider nodes or inside exported graphs.
- Do not cache catalogs by `pluginId` alone while base URL override is in scope.
- Do not make `resolveAgentConfig()` return `null` solely because a Provider node is missing; multiple existing non-runtime flows still rely on it for storage, prompt preview, and maintenance. Add explicit runtime validation instead.
- Do not auto-inject provider web tools unless the agent has already enabled `web_search` or `web_fetch` through its tools config. Provider plugins should replace the implementation, not silently grant extra tools.
- Do not use string-built dynamic imports like `server/providers/plugins/<id>.ts` directly at runtime. Use a static loader map so TS -> JS builds remain valid.
- Do not keep catalog snapshots on node data. Catalog state belongs in server cache + frontend store, not per-node persisted graph data.

## Architecture

Three primary layers follow SAM's existing split:

1. **Core Plugin SDK** (`shared/plugin-sdk/`) - Portable type definitions and pure utility functions. No React dependencies and no server-only runtime logic.
2. **Server Plugin Host** (`server/providers/`) - Plugin lifecycle, auth resolution, registry metadata, config-driven loading, catalog caching, and stream wrapper composition.
3. **UI Layer** (`src/nodes/`, `src/panels/`, `src/store/`, `src/settings/`) - Provider node component, provider editor, provider registry store, and provider-aware catalog/model picking UI.

Cross-cutting concern: runtime validation for "missing provider" and "duplicate provider" must be added separately rather than overloaded into generic graph-to-config resolution.

## Layer 1: Shared Plugin SDK (`shared/plugin-sdk/`)

### Core types (`shared/plugin-sdk/types.ts`)

```ts
interface ProviderPluginDefinition {
  id: string;
  name: string;
  description: string;
  runtimeProviderId: string;
  defaultBaseUrl: string;
  auth: ProviderAuthMethod[];
  catalog?: ProviderPluginCatalog;
  streamFamily?: ProviderStreamFamily;
  wrapStreamFn?: (ctx: ProviderWrapStreamFnContext) => StreamFn | undefined;
  webSearch?: WebSearchProviderPlugin;
  webFetch?: WebFetchProviderPlugin;
}

interface ProviderAuthMethod {
  methodId: string;
  label: string;
  type: 'api-key';
  envVar?: string;
  usesSavedKey?: boolean;
  validate?: (
    key: string,
    baseUrl: string,
    signal?: AbortSignal,
  ) => Promise<boolean>;
}

interface ProviderPluginCatalog {
  refresh: (ctx: ProviderCatalogContext) => Promise<ProviderCatalogResult>;
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

interface ProviderPluginSummary {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  auth: Array<Pick<ProviderAuthMethod, 'methodId' | 'label' | 'type' | 'envVar'>>;
  supportsCatalog: boolean;
  supportsWebSearch: boolean;
  supportsWebFetch: boolean;
}

function definePluginEntry(
  definition: ProviderPluginDefinition,
): ProviderPluginDefinition;
```

Notes:

- `runtimeProviderId` is the provider id that `@mariozechner/pi-ai` expects. It avoids coupling plugin ids to runtime ids forever.
- `ProviderPluginSummary` is the sanitized shape returned to the client. The frontend must not inspect full server plugin definitions directly.
- `catalog` is optional because some providers may not support discovery in v1.

### Stream types (`shared/plugin-sdk/stream.ts`)

```ts
type ProviderStreamFamily =
  | 'openrouter-thinking'
  | 'openai-responses-defaults'
  | 'google-thinking'
  | 'tool-stream-default-on';

type ProviderStreamWrapperFactory =
  | ((streamFn: StreamFn | undefined) => StreamFn | undefined)
  | null
  | undefined
  | false;

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

### Resolved config (`shared/agent-config.ts`)

```ts
interface ResolvedProviderConfig {
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string; // raw override from the node; '' means server fills plugin.defaultBaseUrl
}
```

The existing `provider: string` field on `AgentConfig` becomes `provider: ResolvedProviderConfig`. `modelId` stays as-is.

Important correction: the browser does **not** resolve secrets or plugin defaults. `graph-to-agent.ts` passes the node's auth reference and raw `baseUrl` override only. The server resolves:

- actual base URL: `normalizeBaseUrl(config.provider.baseUrl || plugin.defaultBaseUrl)`
- actual secret: saved key and/or env var fallback

## Validation Semantics

Provider validation must be handled explicitly instead of overloading generic graph resolution:

- Each agent may have **at most one** connected Provider node.
- A missing Provider node blocks runtime start, chat, and provider-dependent model picking.
- A duplicate Provider connection also blocks runtime start until the graph is fixed.
- `resolveAgentConfig()` should still be usable for prompt preview, storage cleanup, and maintenance flows where possible.
- Add a separate helper such as `validateAgentRuntimeGraph()` or `getAgentRuntimeRequirements()` that returns validation errors for:
  - missing provider
  - multiple provider nodes
  - unknown or disabled plugin id
  - invalid auth method selection

## Layer 2: Server Plugin Host (`server/providers/`)

### Plugin Registry (`server/providers/plugin-registry.ts`)

```ts
class ProviderPluginRegistry {
  private plugins: Map<string, ProviderPluginDefinition> = new Map();

  register(plugin: ProviderPluginDefinition): void;
  get(pluginId: string): ProviderPluginDefinition | undefined;
  list(): ProviderPluginDefinition[];
  listSummaries(): ProviderPluginSummary[];
  has(pluginId: string): boolean;
}
```

### Config-driven loading (`server/providers/provider-loader.ts`)

Reads a config file such as:

```json
{
  "providers": [
    { "id": "openrouter", "enabled": true },
    { "id": "anthropic", "enabled": false }
  ]
}
```

Implementation correction: do not resolve plugin modules from a computed file path string. Use a static loader map, for example `server/providers/plugins/index.ts`, so both `tsx` dev mode and compiled JS builds can load plugins reliably.

```ts
function loadProviderPlugins(
  configPath: string,
  registry: ProviderPluginRegistry,
): Promise<void>;
```

Assumption for v1: plugin enablement is read at backend startup. Editing `providers.json` requires a server restart.

### Auth resolution (`server/providers/provider-auth.ts`)

The first draft did not include the service that actually resolves auth. That service is required.

```ts
interface ResolvedProviderRuntimeAuth {
  apiKey: string | null;
  baseUrl: string;
}

function resolveProviderRuntimeAuth(
  config: ResolvedProviderConfig,
  plugin: ProviderPluginDefinition,
  apiKeys: ApiKeyStore,
  env: NodeJS.ProcessEnv,
): ResolvedProviderRuntimeAuth;
```

Responsibilities:

- fill default base URL when node override is empty
- normalize and validate base URLs
- resolve saved key / env var fallback
- optionally run `auth.validate()` when the UI requests validation

### Per-provider catalog cache (`server/providers/catalog-cache.ts`)

All equivalent Provider nodes may share a cached catalog, but the cache key must include normalized base URL.

```ts
interface ProviderCatalogRequest {
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string;
}

class ProviderCatalogCache {
  async load(
    request: ProviderCatalogRequest,
    apiKeyFingerprint?: string,
  ): Promise<ProviderCatalogResponse | null>;

  async refresh(
    request: ProviderCatalogRequest,
    plugin: ProviderPluginDefinition,
    ctx: ProviderCatalogContext,
  ): Promise<ProviderCatalogResponse>;

  async clear(request: ProviderCatalogRequest): Promise<void>;
}
```

Implementation correction:

- cache key = `pluginId + normalized baseUrl`
- account-scoped data such as OpenRouter `userModels` still uses auth fingerprint checks
- the frontend API cannot be `/api/providers/:pluginId/catalog` if base URL override is supported; the request must include provider-instance context

This replaces `OpenRouterModelCatalogStore`.

### Catalog and registry routes

The server must expose provider metadata and provider-instance catalog endpoints:

- `GET /api/providers` -> loaded `ProviderPluginSummary[]`
- `POST /api/providers/catalog/load`
- `POST /api/providers/catalog/refresh`
- `POST /api/providers/catalog/clear`

The request body should include `ProviderCatalogRequest`, not just `pluginId`.

### Stream resolver (`server/providers/stream-resolver.ts`)

```ts
function resolveProviderStreamFn(
  plugin: ProviderPluginDefinition,
  ctx: ProviderWrapStreamFnContext,
): StreamFn | undefined;
```

Resolution order:

1. Start with base `StreamFn` from `pi-agent-core`
2. If the plugin has a `streamFamily`, apply `buildProviderStreamFamilyHooks()`
3. If the plugin has a custom `wrapStreamFn`, apply it
4. Return the composed `StreamFn`

Implementation note: `AgentRuntime` must actually pass the resolved `streamFn` into `new Agent({ streamFn })`. The current runtime does not do this yet.

### OpenRouter plugin (`server/providers/plugins/openrouter.ts`)

Reference implementation:

- `id: 'openrouter'`
- `runtimeProviderId: 'openrouter'`
- `defaultBaseUrl: 'https://openrouter.ai/api/v1'`
- `auth`: single api-key method with default env var `OPENROUTER_API_KEY`
- `catalog.refresh`: migrated from `OpenRouterModelCatalogStore.refresh()`
- `streamFamily: 'openrouter-thinking'`
- `wrapStreamFn`: composes OpenRouter thinking wrapper + HTML entity decoding
- `webSearch`: provider-backed implementation for `web_search`
- `webFetch`: provider-backed implementation for `web_fetch`

Implementation correction: avoid assuming `HEAD /models` is supported for auth validation. Use a provider-supported lightweight GET validation path instead.

## Layer 3: UI Layer

### Provider node (`src/nodes/ProviderNode.tsx`)

New peripheral node type. Connects to agent nodes like memory/tools/storage.

```ts
interface ProviderNodeData {
  [key: string]: unknown;
  type: 'provider';
  label: string;
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string; // optional override; '' = use plugin default
}
```

Implementation corrections:

- Do not store `apiKey` on the node.
- Do not store `catalogModels` or `catalogSyncedAt` on the node.
- Defaults should come from loaded provider metadata. OpenRouter can be the fallback only when it is actually enabled.

### Agent node changes

- Remove `provider` field from `AgentNodeData`
- Keep `modelId` and `modelCapabilities`
- Agent property editor model picker is populated from the connected Provider node's catalog
- Agent card UI derives provider badge text from the connected Provider node or shows a missing-provider state

### Settings and defaults changes

The provider migration affects app settings more than the first draft accounted for.

- Replace hardcoded provider lists in settings and picker utilities with data from `GET /api/providers`
- Split defaults into:
  - `agentDefaults`: modelId, thinkingLevel, systemPrompt, systemPromptMode, safety guardrails
  - `providerDefaults`: pluginId, authMethodId, envVar, baseUrl
- Add provider-default editing to settings so new Provider nodes have sane defaults
- Update reset / maintenance flows to clear all provider catalogs, not just OpenRouter

### Model catalog store changes

`src/store/model-catalog-store.ts` generalizes from hardcoded `openrouter` to provider-instance keyed state.

Implementation correction:

- store key should be based on a normalized catalog key, not just `pluginId`
- request payload must include provider-instance context
- OpenRouter-specific view affordances such as "All Models" vs "My Enabled Models" should be rendered only when the plugin actually returns `userModels`

## Integration Points

### Graph resolution (`src/utils/graph-to-agent.ts`)

- Add a helper to resolve the connected Provider node for an agent
- Build `ResolvedProviderConfig` from Provider node data only
- Keep `modelCapabilities` snapshot behavior on the agent node
- Add explicit validation for zero or multiple Provider nodes

Important correction: do **not** make `resolveAgentConfig()` return `null` just because a Provider node is missing. Existing non-runtime consumers still need storage and prompt data.

### Agent runtime (`server/runtime/agent-runtime.ts`)

- Read `config.provider.pluginId`, look up the plugin from `ProviderPluginRegistry`
- Resolve actual auth + base URL through `resolveProviderRuntimeAuth()`
- Call `resolveProviderStreamFn(plugin, ctx)` and pass the result to `new Agent({ streamFn })`

### Tool factory (`server/runtime/tool-factory.ts`)

- If `web_search` and/or `web_fetch` are already enabled in resolved tool names and the provider plugin exposes implementations, replace the built-in tool creator with the provider-backed one
- Do not add provider web tools when the agent has not enabled those tool names

### Model resolver (`server/runtime/model-resolver.ts`)

- Accept `ResolvedProviderConfig`
- Resolve the plugin and use `plugin.runtimeProviderId` for runtime model lookup
- Apply resolved base URL overrides to the runtime model template where supported

### Run coordinator / hooks / sessions

The provider field shape change reaches farther than the initial draft listed.

- `server/agents/run-coordinator.ts` must convert transcript/session-facing provider values to `pluginId` strings where those surfaces still expect strings
- `server/hooks/hook-types.ts` must revisit `BeforeModelResolveContext.overrides.provider` so hooks remain coherent after provider config becomes structured
- `src/chat/ChatDrawer.tsx` and `src/store/session-store.ts` must use `config.provider.pluginId` for session metadata instead of assuming `config.provider` is a string

## File Changes

### Files to create

| File | Purpose |
|------|---------|
| `shared/plugin-sdk/types.ts` | Core plugin definitions + client-safe provider summaries |
| `shared/plugin-sdk/stream.ts` | Stream wrapper types + `composeProviderStreamWrappers` |
| `shared/plugin-sdk/web-contracts.ts` | WebSearch/WebFetch plugin contracts |
| `shared/plugin-sdk/entry.ts` | `definePluginEntry()` helper |
| `shared/plugin-sdk/index.ts` | Barrel export |
| `server/providers/plugin-registry.ts` | Registry + summary projection |
| `server/providers/provider-loader.ts` | Config-driven plugin loading |
| `server/providers/provider-auth.ts` | Runtime auth + base URL resolution |
| `server/providers/catalog-cache.ts` | Provider-instance catalog cache |
| `server/providers/stream-resolver.ts` | Stream function resolution |
| `server/providers/plugins/index.ts` | Static plugin loader map |
| `server/providers/plugins/openrouter.ts` | OpenRouter plugin definition |
| `src/nodes/ProviderNode.tsx` | Provider node UI component |
| `src/panels/property-editors/ProviderProperties.tsx` | Property editor for Provider nodes |
| `src/store/provider-registry-store.ts` | Frontend store for provider metadata |
| `docs/concepts/provider-node.md` | Concept doc for the new Provider node |

### Files to modify

| File | Change |
|------|--------|
| `src/types/nodes.ts` | Add `'provider'` to `NodeType`, add `ProviderNodeData`, add to union, remove `provider` from `AgentNodeData` |
| `src/utils/default-nodes.ts` | Add `'provider'` case using provider defaults, not inline secrets |
| `src/utils/graph-to-agent.ts` | Add Provider node resolution and runtime validation helpers |
| `src/utils/export-import.ts` | Ensure imports/exports tolerate the new Provider node type |
| `src/nodes/node-registry.ts` | Add `provider: ProviderNode` |
| `src/nodes/AgentNode.tsx` | Derive provider badge from connected Provider node or show missing-provider state |
| `src/panels/PropertiesPanel.tsx` | Route `provider` nodes to the new editor |
| `src/panels/Sidebar.tsx` | Add Provider node to the palette |
| `src/utils/theme.ts` | Add Provider node label/color |
| `src/panels/property-editors/AgentProperties.tsx` | Remove provider selector; derive model options from connected Provider node |
| `src/chat/ChatDrawer.tsx` | Add missing-provider validation UI and use `pluginId` for session metadata |
| `src/store/graph-store.ts` | Support Provider nodes, provider defaults, and any apply-defaults actions |
| `src/store/model-catalog-store.ts` | Generalize catalog state to provider-instance keys and new routes |
| `src/settings/types.ts` | Add provider defaults and replace agent-level provider defaults |
| `src/settings/settings-store.ts` | Persist provider defaults and provider-driven settings data |
| `src/settings/sections/DefaultsSection.tsx` | Split agent defaults from provider defaults |
| `src/settings/sections/ModelCatalogSection.tsx` | Make the catalog UI provider-driven instead of OpenRouter-only |
| `src/settings/sections/ProvidersApiKeysSection.tsx` | Drive the list from registry metadata instead of a hardcoded provider array |
| `src/settings/sections/DataMaintenanceSection.tsx` | Clear all provider catalogs, not just OpenRouter |
| `src/settings/SettingsWorkspace.tsx` | Render provider-aware settings sections as needed |
| `src/App.tsx` | Load provider metadata before provider-dependent UI/store work |
| `shared/agent-config.ts` | Add `ResolvedProviderConfig`, change `provider` field type on `AgentConfig` |
| `shared/model-catalog.ts` | Replace OpenRouter-specific response types with provider-instance-aware types |
| `shared/session-routes.ts` | Keep session route provider payloads coherent after provider config becomes structured |
| `server/runtime/model-resolver.ts` | Resolve runtime models through plugin metadata |
| `server/runtime/agent-runtime.ts` | Resolve stream function through plugin registry and runtime auth |
| `server/runtime/tool-factory.ts` | Replace built-in web tool creators with provider-backed implementations when enabled |
| `server/agents/agent-manager.ts` | Thread provider registry/cache/auth dependencies into runtime creation |
| `server/agents/run-coordinator.ts` | Handle structured provider config while preserving string-based transcript/session metadata where needed |
| `server/hooks/hook-types.ts` | Revisit provider override hook types |
| `server/index.ts` | Initialize registry + cache, expose provider routes, load plugins from config |
| `server/auth/api-keys.ts` | Support provider-plugin keyed lookup without assuming agent node provider strings |
| `docs/concepts/_manifest.json` | Add Provider node mapping |
| `docs/concepts/agent-node.md` | Remove agent-owned provider config from docs and explain Provider-node dependency |

### Files to delete

| File | Reason |
|------|--------|
| `server/runtime/openrouter-model-catalog-store.ts` | Replaced by `catalog-cache.ts` + `openrouter.ts` plugin |
| `server/runtime/openrouter-model-catalog-store.test.ts` | Tests move to provider cache/plugin coverage |

## Test Surface That Must Be Updated

The first draft underestimated the test blast radius. At minimum, update:

- `src/utils/graph-to-agent.test.ts`
- `src/utils/default-nodes.test.ts`
- `src/store/graph-store.test.ts`
- `src/store/model-catalog-store.test.ts`
- `src/panels/property-editors/AgentProperties.test.tsx`
- `src/settings/sections/DefaultsSection.test.tsx`
- `src/settings/sections/ModelCatalogSection.test.tsx`
- `src/settings/sections/ProvidersApiKeysSection.test.tsx`
- `src/settings/sections/DataMaintenanceSection.test.tsx`
- `src/settings/settings-store.test.ts`
- `src/App.test.tsx`
- `server/runtime/model-resolver.test.ts`
- `server/runtime/agent-runtime.test.ts`
- `server/agents/agent-manager.test.ts`
- `server/agents/run-coordinator.test.ts`
- `server/agents/openrouter.integration.test.ts`

Also update any fixtures that still serialize `agent.data.provider`, including `src/fixtures/test-graph.json`.

## Breaking Changes

- Existing saved graphs with `provider` on the agent node will no longer be runnable. Users must add a Provider node and connect it.
- Persisted settings shape changes because provider defaults move out of `agentDefaults`.
- OpenRouter-specific catalog routes are replaced by provider-instance-aware routes.
- Provider loading is startup-time only in v1; changing `providers.json` requires a backend restart.

## Assumptions and Safety Notes

- Base URL overrides must be normalized and validated on the server before use.
- Provider nodes are allowed to reference env var names, but they do not reveal the values.
- OpenRouter remains the only fully implemented provider in v1; the SDK is generic, but the initial implementation should not pretend Anthropic/OpenAI/etc are already wired as first-class plugins until that code exists.
