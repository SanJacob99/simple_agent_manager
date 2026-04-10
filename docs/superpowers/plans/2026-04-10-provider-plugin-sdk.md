# Provider Plugin SDK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded OpenRouter integration with a modular provider plugin SDK so any model provider can be added as a plugin, starting with OpenRouter as the first.

**Architecture:** Three-layer design matching SAM's existing split: shared types in `shared/plugin-sdk/`, server plugin host in `server/providers/`, and UI updates across `src/`. A new Provider peripheral node connects to agent nodes and owns provider identity, auth method selection, env var name, and base URL override. The agent node loses its `provider` field and delegates provider resolution to the connected Provider node.

**Tech Stack:** TypeScript, React, Zustand, Express, Vitest, @xyflow/react, @mariozechner/pi-ai / pi-agent-core

**Spec:** `docs/superpowers/specs/2026-04-09-provider-plugin-sdk-design.md`

---

## File Structure

### Files to create

| File | Responsibility |
|------|---------------|
| `shared/plugin-sdk/types.ts` | `ProviderPluginDefinition`, `ProviderAuthMethod`, `ProviderPluginCatalog`, `ProviderCatalogContext`, `ProviderCatalogResult`, `ProviderPluginSummary` |
| `shared/plugin-sdk/stream.ts` | `ProviderStreamFamily`, `ProviderStreamWrapperFactory`, `ProviderWrapStreamFnContext`, `composeProviderStreamWrappers()` |
| `shared/plugin-sdk/web-contracts.ts` | `WebSearchProviderPlugin`, `WebFetchProviderPlugin`, context types |
| `shared/plugin-sdk/entry.ts` | `definePluginEntry()` identity helper |
| `shared/plugin-sdk/catalog-request.ts` | `ProviderCatalogRequest` type (shared between server and frontend) |
| `shared/plugin-sdk/index.ts` | Barrel export |
| `server/providers/plugin-registry.ts` | `ProviderPluginRegistry` class |
| `server/providers/provider-auth.ts` | `resolveProviderRuntimeAuth()` + base URL normalization |
| `server/providers/catalog-cache.ts` | `ProviderCatalogCache` class (replaces `OpenRouterModelCatalogStore`) |
| `server/providers/stream-resolver.ts` | `resolveProviderStreamFn()` |
| `server/providers/provider-loader.ts` | `loadProviderPlugins()` from config JSON |
| `server/providers/plugins/index.ts` | Static loader map (`pluginId -> definition`) |
| `server/providers/plugins/openrouter.ts` | OpenRouter plugin definition |
| `src/nodes/ProviderNode.tsx` | Provider node React component |
| `src/panels/property-editors/ProviderProperties.tsx` | Property editor for Provider nodes |
| `src/store/provider-registry-store.ts` | Frontend Zustand store for loaded provider summaries |
| `docs/concepts/provider-node.md` | Concept doc for the Provider node |

### Files to modify

| File | Change summary |
|------|---------------|
| `shared/agent-config.ts` | Add `ResolvedProviderConfig`, change `AgentConfig.provider` type |
| `shared/model-catalog.ts` | Replace `OpenRouterCatalogResponse` with generic `ProviderCatalogResponse` |
| `shared/session-routes.ts` | Keep `provider?: string` on `SessionRouteRequest` (already correct) |
| `src/types/nodes.ts` | Add `'provider'` to `NodeType`, add `ProviderNodeData`, remove `provider` from `AgentNodeData` |
| `src/utils/default-nodes.ts` | Add `'provider'` case, remove `provider` from agent defaults |
| `src/utils/graph-to-agent.ts` | Resolve Provider node, build `ResolvedProviderConfig`, add validation helper |
| `src/utils/export-import.ts` | Tolerate provider nodes during import migration |
| `src/utils/theme.ts` | Add Provider node color + label |
| `src/nodes/node-registry.ts` | Add `provider: ProviderNode` |
| `src/nodes/AgentNode.tsx` | Derive provider badge from connected Provider node |
| `src/panels/PropertiesPanel.tsx` | Route `'provider'` to `ProviderProperties` |
| `src/panels/Sidebar.tsx` | Add Provider to peripheral palette |
| `src/panels/property-editors/AgentProperties.tsx` | Remove provider selector, derive model options from connected provider |
| `src/store/graph-store.ts` | Add provider defaults to `buildNodeData()` |
| `src/store/model-catalog-store.ts` | Generalize to provider-instance keyed state |
| `src/chat/ChatDrawer.tsx` | Add missing-provider validation, use `pluginId` for sessions |
| `src/settings/types.ts` | Add `ProviderDefaults`, split from `AgentDefaults` |
| `src/settings/settings-store.ts` | Add `providerDefaults` + persistence |
| `src/settings/sections/DefaultsSection.tsx` | Split agent defaults from provider defaults |
| `src/settings/sections/ModelCatalogSection.tsx` | Make provider-driven |
| `src/settings/sections/ProvidersApiKeysSection.tsx` | Drive from registry metadata |
| `src/settings/sections/DataMaintenanceSection.tsx` | Clear all provider catalogs |
| `src/App.tsx` | Load provider registry on mount, generalize catalog init |
| `server/runtime/model-resolver.ts` | Accept `ResolvedProviderConfig`, use `runtimeProviderId` |
| `server/runtime/agent-runtime.ts` | Resolve provider auth + stream function via plugin registry |
| `server/runtime/tool-factory.ts` | Replace web tool creators with provider-backed ones when available |
| `server/agents/agent-manager.ts` | Thread registry/cache/auth dependencies |
| `server/agents/run-coordinator.ts` | Handle structured provider config for hooks + sessions |
| `server/hooks/hook-types.ts` | Update `BeforeModelResolveContext.overrides.provider` type |
| `server/index.ts` | Init registry + cache, replace hardcoded catalog routes |
| `server/auth/api-keys.ts` | No structural change, already keyed by string |
| `docs/concepts/_manifest.json` | Add provider entry |
| `docs/concepts/agent-node.md` | Remove provider config, add Provider-node dependency |

### Files to delete

| File | Reason |
|------|--------|
| `server/runtime/openrouter-model-catalog-store.ts` | Replaced by `catalog-cache.ts` + `openrouter.ts` plugin |
| `server/runtime/openrouter-model-catalog-store.test.ts` | Tests move to provider cache/plugin coverage |

---

## Task 1: Shared Plugin SDK Types

**Files:**
- Create: `shared/plugin-sdk/types.ts`
- Create: `shared/plugin-sdk/stream.ts`
- Create: `shared/plugin-sdk/web-contracts.ts`
- Create: `shared/plugin-sdk/entry.ts`
- Create: `shared/plugin-sdk/index.ts`

- [ ] **Step 1: Create `shared/plugin-sdk/types.ts`**

```ts
import type { DiscoveredModelMetadata } from '../agent-config';

// --- Auth ---

export interface ProviderAuthMethod {
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

// --- Catalog ---

export interface ProviderCatalogContext {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface ProviderCatalogResult {
  models: Record<string, DiscoveredModelMetadata>;
  userModels?: Record<string, DiscoveredModelMetadata>;
}

export interface ProviderPluginCatalog {
  refresh: (ctx: ProviderCatalogContext) => Promise<ProviderCatalogResult>;
}

// --- Plugin definition ---

export interface ProviderPluginDefinition {
  id: string;
  name: string;
  description: string;
  runtimeProviderId: string;
  defaultBaseUrl: string;
  auth: ProviderAuthMethod[];
  catalog?: ProviderPluginCatalog;
  streamFamily?: import('./stream').ProviderStreamFamily;
  wrapStreamFn?: (
    ctx: import('./stream').ProviderWrapStreamFnContext,
  ) => import('./stream').StreamFn | undefined;
  webSearch?: import('./web-contracts').WebSearchProviderPlugin;
  webFetch?: import('./web-contracts').WebFetchProviderPlugin;
}

// --- Client-safe summary ---

export interface ProviderPluginSummary {
  id: string;
  name: string;
  description: string;
  defaultBaseUrl: string;
  auth: Array<
    Pick<ProviderAuthMethod, 'methodId' | 'label' | 'type' | 'envVar'>
  >;
  supportsCatalog: boolean;
  supportsWebSearch: boolean;
  supportsWebFetch: boolean;
}
```

- [ ] **Step 2: Create `shared/plugin-sdk/stream.ts`**

```ts
export type StreamFn = (...args: any[]) => any;

export type ProviderStreamFamily =
  | 'openrouter-thinking'
  | 'openai-responses-defaults'
  | 'google-thinking'
  | 'tool-stream-default-on';

export type ProviderStreamWrapperFactory =
  | ((streamFn: StreamFn | undefined) => StreamFn | undefined)
  | null
  | undefined
  | false;

export interface ProviderWrapStreamFnContext {
  streamFn: StreamFn | undefined;
  thinkingLevel: string;
  modelId: string;
  config?: unknown;
  extraParams?: Record<string, unknown>;
}

export function composeProviderStreamWrappers(
  base: StreamFn | undefined,
  ...wrappers: ProviderStreamWrapperFactory[]
): StreamFn | undefined {
  let current = base;
  for (const wrapper of wrappers) {
    if (typeof wrapper === 'function') {
      current = wrapper(current);
    }
  }
  return current;
}
```

- [ ] **Step 3: Create `shared/plugin-sdk/web-contracts.ts`**

```ts
import type { AgentTool } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';

export interface WebSearchToolContext {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface WebFetchToolContext {
  apiKey: string;
  baseUrl: string;
  signal?: AbortSignal;
}

export interface WebSearchProviderPlugin {
  id: string;
  label: string;
  createTool: (ctx: WebSearchToolContext) => AgentTool<TSchema>;
}

export interface WebFetchProviderPlugin {
  id: string;
  label: string;
  createTool: (ctx: WebFetchToolContext) => AgentTool<TSchema>;
}
```

- [ ] **Step 4: Create `shared/plugin-sdk/entry.ts`**

```ts
import type { ProviderPluginDefinition } from './types';

export function definePluginEntry(
  definition: ProviderPluginDefinition,
): ProviderPluginDefinition {
  return definition;
}
```

- [ ] **Step 5: Create `shared/plugin-sdk/catalog-request.ts`**

This type is used by both the server (`catalog-cache.ts`) and the frontend (`model-catalog-store.ts`), so it lives in `shared/`.

```ts
export interface ProviderCatalogRequest {
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string;
}
```

- [ ] **Step 6: Create `shared/plugin-sdk/index.ts`**

```ts
export type {
  ProviderPluginDefinition,
  ProviderAuthMethod,
  ProviderPluginCatalog,
  ProviderCatalogContext,
  ProviderCatalogResult,
  ProviderPluginSummary,
} from './types';

export type {
  StreamFn,
  ProviderStreamFamily,
  ProviderStreamWrapperFactory,
  ProviderWrapStreamFnContext,
} from './stream';
export { composeProviderStreamWrappers } from './stream';

export type {
  WebSearchProviderPlugin,
  WebFetchProviderPlugin,
  WebSearchToolContext,
  WebFetchToolContext,
} from './web-contracts';

export { definePluginEntry } from './entry';

export type { ProviderCatalogRequest } from './catalog-request';
```

- [ ] **Step 7: Commit**

```bash
git add shared/plugin-sdk/
git commit -m "feat: add shared plugin SDK types for provider integration"
```

---

## Task 2: `ResolvedProviderConfig` and `AgentConfig.provider` Type Change

**Files:**
- Modify: `shared/agent-config.ts`
- Modify: `shared/model-catalog.ts`

- [ ] **Step 1: Add `ResolvedProviderConfig` to `shared/agent-config.ts`**

Add before the `AgentConfig` interface (after line 105):

```ts
export interface ResolvedProviderConfig {
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string; // raw override from node; '' means server fills plugin.defaultBaseUrl
}
```

- [ ] **Step 2: Change `AgentConfig.provider` type**

In `shared/agent-config.ts`, change line 113 from:

```ts
  provider: string;
```

to:

```ts
  provider: ResolvedProviderConfig;
```

- [ ] **Step 3: Update `shared/model-catalog.ts`**

Replace the full file contents:

```ts
import type { DiscoveredModelMetadata } from './agent-config';

export type ProviderModelMap = Record<string, DiscoveredModelMetadata>;

/** Generic catalog response for any provider instance. */
export interface ProviderCatalogResponse {
  models: ProviderModelMap;
  userModels: ProviderModelMap;
  syncedAt: string | null;
  userModelsRequireRefresh: boolean;
}

/**
 * @deprecated Use ProviderCatalogResponse instead.
 * Kept temporarily for migration — will be removed when all consumers switch.
 */
export type OpenRouterCatalogResponse = ProviderCatalogResponse;
```

- [ ] **Step 4: Commit**

```bash
git add shared/agent-config.ts shared/model-catalog.ts
git commit -m "feat: add ResolvedProviderConfig and generalize catalog response type"
```

---

## Task 3: Node Type Definitions and Defaults

**Files:**
- Modify: `src/types/nodes.ts`
- Modify: `src/utils/default-nodes.ts`
- Modify: `src/utils/theme.ts`
- Test: `src/utils/default-nodes.test.ts`

- [ ] **Step 1: Add `ProviderNodeData` and update `NodeType` in `src/types/nodes.ts`**

Add `'provider'` to the `NodeType` union (after `'cron'` on line 15):

```ts
  | 'provider';
```

Add a new interface after `CronNodeData` (after line 205):

```ts
export interface ProviderNodeData {
  [key: string]: unknown;
  type: 'provider';
  label: string;
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string;
}
```

Add `ProviderNodeData` to the `FlowNodeData` union (before the closing semicolon on line 219):

```ts
  | ProviderNodeData;
```

- [ ] **Step 2: Remove `provider` from `AgentNodeData`**

In `src/types/nodes.ts`, remove line 21:

```ts
  provider: string;
```

The agent node no longer owns provider identity.

- [ ] **Step 3: Add provider case to `src/utils/default-nodes.ts`**

Remove `provider: 'openrouter',` from the agent case (line 9 of the function body).

Add a new case before the `default` throw (after the cron case, around line 130):

```ts
    case 'provider':
      return {
        type: 'provider',
        label: 'Provider',
        pluginId: 'openrouter',
        authMethodId: 'api-key',
        envVar: 'OPENROUTER_API_KEY',
        baseUrl: '',
      };
```

- [ ] **Step 4: Add provider to `src/utils/theme.ts`**

Add to `NODE_COLORS` (using `#6366f1` indigo-500 since cron already uses `#8b5cf6`):

```ts
  provider: '#6366f1',
```

Add to `NODE_LABELS`:

```ts
  provider: 'Provider',
```

- [ ] **Step 5: Update `src/utils/default-nodes.test.ts`**

Add a test for the new provider defaults:

```ts
it('returns provider defaults', () => {
  const data = getDefaultNodeData('provider');
  expect(data.type).toBe('provider');
  if (data.type !== 'provider') throw new Error('unreachable');
  expect(data.pluginId).toBe('openrouter');
  expect(data.authMethodId).toBe('api-key');
  expect(data.envVar).toBe('OPENROUTER_API_KEY');
  expect(data.baseUrl).toBe('');
});
```

Update any existing agent default test that asserts `data.provider === 'openrouter'` — remove that assertion since agents no longer have a `provider` field.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/utils/default-nodes.test.ts --reporter=verbose`
Expected: All tests pass including the new provider test.

- [ ] **Step 7: Commit**

```bash
git add src/types/nodes.ts src/utils/default-nodes.ts src/utils/theme.ts src/utils/default-nodes.test.ts
git commit -m "feat: add Provider node type, remove provider from AgentNodeData"
```

---

## Task 4: Graph Resolution — Provider Node + Validation

**Files:**
- Modify: `src/utils/graph-to-agent.ts`
- Test: `src/utils/graph-to-agent.test.ts`

- [ ] **Step 1: Write failing tests for provider resolution**

Add to `src/utils/graph-to-agent.test.ts`:

```ts
describe('provider node resolution', () => {
  const baseAgent = {
    id: 'agent-1',
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      type: 'agent' as const,
      name: 'Test',
      nameConfirmed: true,
      systemPrompt: 'hello',
      systemPromptMode: 'append' as const,
      modelId: 'anthropic/claude-sonnet-4-20250514',
      thinkingLevel: 'off' as const,
      description: '',
      tags: [],
      modelCapabilities: {},
      showReasoning: false,
      verbose: false,
    },
  };

  const providerNode = {
    id: 'provider-1',
    type: 'provider',
    position: { x: 0, y: 0 },
    data: {
      type: 'provider' as const,
      label: 'Provider',
      pluginId: 'openrouter',
      authMethodId: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: '',
    },
  };

  const providerEdge = {
    id: 'e1',
    source: 'provider-1',
    target: 'agent-1',
    type: 'data',
  };

  it('resolves ResolvedProviderConfig from connected provider node', () => {
    const result = resolveAgentConfig(
      'agent-1',
      [baseAgent as any, providerNode as any],
      [providerEdge as any],
    );
    expect(result).not.toBeNull();
    expect(result!.provider).toEqual({
      pluginId: 'openrouter',
      authMethodId: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      baseUrl: '',
    });
  });

  it('returns config with null-ish provider when no provider node connected', () => {
    const result = resolveAgentConfig(
      'agent-1',
      [baseAgent as any],
      [],
    );
    // resolveAgentConfig must still return a config (not null) for non-runtime consumers
    expect(result).not.toBeNull();
    expect(result!.provider).toEqual({
      pluginId: '',
      authMethodId: '',
      envVar: '',
      baseUrl: '',
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `npx vitest run src/utils/graph-to-agent.test.ts --reporter=verbose`
Expected: FAIL — `provider` is currently a string `'openrouter'`, not a `ResolvedProviderConfig`.

- [ ] **Step 3: Update `resolveAgentConfig` to resolve Provider node**

In `src/utils/graph-to-agent.ts`, add after the agent node lookup (after line 25):

```ts
  // --- Provider ---
  const providerNode = connectedNodes.find((n) => n.data.type === 'provider');
  const providerConfig: import('../../shared/agent-config').ResolvedProviderConfig =
    providerNode && providerNode.data.type === 'provider'
      ? {
          pluginId: providerNode.data.pluginId as string,
          authMethodId: providerNode.data.authMethodId as string,
          envVar: providerNode.data.envVar as string,
          baseUrl: providerNode.data.baseUrl as string,
        }
      : { pluginId: '', authMethodId: '', envVar: '', baseUrl: '' };
```

Update the return object (line 233) — change:

```ts
    provider: data.provider,
```

to:

```ts
    provider: providerConfig,
```

Add the import for `ResolvedProviderConfig` at the top:

```ts
import type { AgentConfig, ResolvedProviderConfig } from '../../shared/agent-config';
```

- [ ] **Step 4: Add `validateAgentRuntimeGraph` helper**

Add at the end of `src/utils/graph-to-agent.ts`:

```ts
export interface AgentGraphValidationError {
  code: 'missing_provider' | 'duplicate_provider' | 'empty_plugin_id';
  message: string;
}

export function validateAgentRuntimeGraph(
  agentNodeId: string,
  nodes: AppNode[],
  edges: Edge[],
): AgentGraphValidationError[] {
  const errors: AgentGraphValidationError[] = [];

  const connectedEdges = edges.filter((e) => e.target === agentNodeId);
  const connectedNodes = connectedEdges
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter((n): n is AppNode => n !== undefined);

  const providerNodes = connectedNodes.filter((n) => n.data.type === 'provider');

  if (providerNodes.length === 0) {
    errors.push({
      code: 'missing_provider',
      message: 'Agent requires a connected Provider node to run.',
    });
  } else if (providerNodes.length > 1) {
    errors.push({
      code: 'duplicate_provider',
      message: 'Agent must have exactly one connected Provider node.',
    });
  } else if (
    providerNodes[0].data.type === 'provider' &&
    !(providerNodes[0].data.pluginId as string)
  ) {
    errors.push({
      code: 'empty_plugin_id',
      message: 'Provider node has no plugin selected.',
    });
  }

  return errors;
}
```

- [ ] **Step 5: Update existing tests that assert `provider` is a string**

Search the test file for assertions like `expect(result.provider).toBe('openrouter')` and update them. In each existing test that creates an agent node with `provider: 'openrouter'`, remove the `provider` field from the agent data. Update provider assertions to check for the empty placeholder or a connected provider node.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/utils/graph-to-agent.test.ts --reporter=verbose`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/utils/graph-to-agent.ts src/utils/graph-to-agent.test.ts
git commit -m "feat: resolve Provider node in graph-to-agent, add runtime validation helper"
```

---

## Task 5: Server Plugin Registry and Loader

**Files:**
- Create: `server/providers/plugin-registry.ts`
- Create: `server/providers/provider-loader.ts`
- Create: `server/providers/plugins/index.ts`

- [ ] **Step 1: Create `server/providers/plugin-registry.ts`**

```ts
import type {
  ProviderPluginDefinition,
  ProviderPluginSummary,
} from '../../shared/plugin-sdk';

export class ProviderPluginRegistry {
  private plugins = new Map<string, ProviderPluginDefinition>();

  register(plugin: ProviderPluginDefinition): void {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Provider plugin "${plugin.id}" is already registered.`);
    }
    this.plugins.set(plugin.id, plugin);
  }

  get(pluginId: string): ProviderPluginDefinition | undefined {
    return this.plugins.get(pluginId);
  }

  list(): ProviderPluginDefinition[] {
    return [...this.plugins.values()];
  }

  listSummaries(): ProviderPluginSummary[] {
    return this.list().map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      defaultBaseUrl: p.defaultBaseUrl,
      auth: p.auth.map((a) => ({
        methodId: a.methodId,
        label: a.label,
        type: a.type,
        envVar: a.envVar,
      })),
      supportsCatalog: !!p.catalog,
      supportsWebSearch: !!p.webSearch,
      supportsWebFetch: !!p.webFetch,
    }));
  }

  has(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }
}
```

- [ ] **Step 2: Create static loader map `server/providers/plugins/index.ts`**

```ts
import type { ProviderPluginDefinition } from '../../../shared/plugin-sdk';
import { openrouterPlugin } from './openrouter';

/**
 * Static loader map — every plugin must be imported here so that
 * both tsx dev and compiled JS builds can resolve them.
 */
export const PLUGIN_MAP: Record<string, ProviderPluginDefinition> = {
  openrouter: openrouterPlugin,
};
```

Note: This file will have a compile error until Task 7 creates the OpenRouter plugin. That's expected — we'll create a stub in this step.

Create a temporary stub at `server/providers/plugins/openrouter.ts`:

```ts
import { definePluginEntry } from '../../../shared/plugin-sdk';

export const openrouterPlugin = definePluginEntry({
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'Access 200+ models through OpenRouter',
  runtimeProviderId: 'openrouter',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  auth: [
    {
      methodId: 'api-key',
      label: 'API Key',
      type: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      usesSavedKey: true,
    },
  ],
  // catalog, stream, web — added in Task 7
});
```

- [ ] **Step 3: Create `server/providers/provider-loader.ts`**

```ts
import fs from 'fs/promises';
import { PLUGIN_MAP } from './plugins/index';
import type { ProviderPluginRegistry } from './plugin-registry';

interface ProviderConfigEntry {
  id: string;
  enabled: boolean;
}

interface ProvidersConfig {
  providers: ProviderConfigEntry[];
}

export async function loadProviderPlugins(
  configPath: string,
  registry: ProviderPluginRegistry,
): Promise<void> {
  let config: ProvidersConfig;
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(raw) as ProvidersConfig;
  } catch {
    // No config file — register all known plugins as enabled by default
    for (const plugin of Object.values(PLUGIN_MAP)) {
      registry.register(plugin);
    }
    console.log(
      `[Providers] No providers.json found at ${configPath}; loaded ${Object.keys(PLUGIN_MAP).length} default plugin(s).`,
    );
    return;
  }

  for (const entry of config.providers) {
    if (!entry.enabled) continue;

    const plugin = PLUGIN_MAP[entry.id];
    if (!plugin) {
      console.warn(
        `[Providers] Config references plugin "${entry.id}" but no implementation found in PLUGIN_MAP. Skipping.`,
      );
      continue;
    }

    registry.register(plugin);
  }

  console.log(
    `[Providers] Loaded ${registry.list().length} plugin(s) from ${configPath}.`,
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add server/providers/
git commit -m "feat: add provider plugin registry and config-driven loader"
```

---

## Task 6: Provider Auth Resolution and Catalog Cache

**Files:**
- Create: `server/providers/provider-auth.ts`
- Create: `server/providers/catalog-cache.ts`

- [ ] **Step 1: Create `server/providers/provider-auth.ts`**

```ts
import type { ResolvedProviderConfig } from '../../shared/agent-config';
import type { ProviderPluginDefinition } from '../../shared/plugin-sdk';
import type { ApiKeyStore } from '../auth/api-keys';

export interface ResolvedProviderRuntimeAuth {
  apiKey: string | null;
  baseUrl: string;
}

/**
 * Normalize a base URL: trim whitespace, strip trailing slash.
 */
export function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

/**
 * Build a cache key for catalog lookups: pluginId + normalized base URL.
 */
export function buildCatalogCacheKey(pluginId: string, baseUrl: string): string {
  return `${pluginId}::${normalizeBaseUrl(baseUrl)}`;
}

/**
 * Resolve the actual API key and base URL for a provider at runtime.
 *
 * Resolution order for API key:
 *   1. Saved key in ApiKeyStore (keyed by pluginId)
 *   2. Environment variable fallback (config.envVar)
 *
 * Resolution for base URL:
 *   1. Node override (config.baseUrl) if non-empty
 *   2. Plugin's defaultBaseUrl
 */
export function resolveProviderRuntimeAuth(
  config: ResolvedProviderConfig,
  plugin: ProviderPluginDefinition,
  apiKeys: ApiKeyStore,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedProviderRuntimeAuth {
  // Resolve API key: saved key first, then env var fallback
  const savedKey = apiKeys.get(plugin.id);
  const envKey = config.envVar ? env[config.envVar] : undefined;
  const apiKey = savedKey || envKey || null;

  // Resolve base URL: node override first, then plugin default
  const rawBaseUrl = config.baseUrl || plugin.defaultBaseUrl;
  const baseUrl = normalizeBaseUrl(rawBaseUrl);

  return { apiKey, baseUrl };
}
```

- [ ] **Step 2: Create `server/providers/catalog-cache.ts`**

```ts
import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { ProviderModelMap, ProviderCatalogResponse } from '../../shared/model-catalog';
import type { ProviderPluginDefinition, ProviderCatalogContext, ProviderCatalogRequest } from '../../shared/plugin-sdk';
import { buildCatalogCacheKey, normalizeBaseUrl } from './provider-auth';

export type { ProviderCatalogRequest } from '../../shared/plugin-sdk';

interface PersistedCatalog {
  models: ProviderModelMap;
  userModels: ProviderModelMap;
  syncedAt: string | null;
  userModelsKeyFingerprint: string | null;
}

const EMPTY_RESPONSE: ProviderCatalogResponse = {
  models: {},
  userModels: {},
  syncedAt: null,
  userModelsRequireRefresh: false,
};

export class ProviderCatalogCache {
  constructor(private readonly cacheDir: string = process.cwd()) {}

  private filePath(request: ProviderCatalogRequest): string {
    const key = buildCatalogCacheKey(request.pluginId, request.baseUrl);
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
    return path.join(this.cacheDir, `provider-catalog-${request.pluginId}-${hash}.json`);
  }

  private fingerprint(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex');
  }

  async load(
    request: ProviderCatalogRequest,
    apiKeyFingerprint?: string,
  ): Promise<ProviderCatalogResponse | null> {
    const persisted = await this.readPersisted(request);
    if (!persisted) return null;
    return this.toClientResponse(persisted, apiKeyFingerprint);
  }

  async refresh(
    request: ProviderCatalogRequest,
    plugin: ProviderPluginDefinition,
    ctx: ProviderCatalogContext,
  ): Promise<ProviderCatalogResponse> {
    if (!plugin.catalog) {
      return { ...EMPTY_RESPONSE };
    }

    const result = await plugin.catalog.refresh(ctx);

    const persisted: PersistedCatalog = {
      models: result.models,
      userModels: result.userModels ?? {},
      syncedAt: new Date().toISOString(),
      userModelsKeyFingerprint: ctx.apiKey ? this.fingerprint(ctx.apiKey) : null,
    };

    await this.writePersisted(request, persisted);
    return this.toClientResponse(
      persisted,
      ctx.apiKey ? this.fingerprint(ctx.apiKey) : undefined,
    );
  }

  async clear(request: ProviderCatalogRequest): Promise<void> {
    await fs.rm(this.filePath(request), { force: true });
  }

  async clearAll(): Promise<void> {
    try {
      const entries = await fs.readdir(this.cacheDir);
      await Promise.all(
        entries
          .filter((f) => f.startsWith('provider-catalog-') && f.endsWith('.json'))
          .map((f) => fs.rm(path.join(this.cacheDir, f), { force: true })),
      );
    } catch {
      // Directory may not exist
    }
  }

  // --- Private helpers ---

  private async readPersisted(
    request: ProviderCatalogRequest,
  ): Promise<PersistedCatalog | null> {
    try {
      const raw = await fs.readFile(this.filePath(request), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PersistedCatalog>;
      return {
        models: parsed.models ?? {},
        userModels: parsed.userModels ?? {},
        syncedAt: parsed.syncedAt ?? null,
        userModelsKeyFingerprint: parsed.userModelsKeyFingerprint ?? null,
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async writePersisted(
    request: ProviderCatalogRequest,
    catalog: PersistedCatalog,
  ): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath(request)), { recursive: true });
    await fs.writeFile(
      this.filePath(request),
      JSON.stringify(catalog, null, 2),
      'utf-8',
    );
  }

  private toClientResponse(
    catalog: PersistedCatalog,
    apiKeyFingerprint?: string,
  ): ProviderCatalogResponse {
    if (!apiKeyFingerprint) {
      return {
        models: catalog.models,
        userModels: {},
        syncedAt: catalog.syncedAt,
        userModelsRequireRefresh: false,
      };
    }

    const matchesFingerprint =
      !catalog.userModelsKeyFingerprint ||
      catalog.userModelsKeyFingerprint === apiKeyFingerprint;

    return {
      models: catalog.models,
      userModels: matchesFingerprint ? catalog.userModels : {},
      syncedAt: catalog.syncedAt,
      userModelsRequireRefresh: !matchesFingerprint,
    };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add server/providers/provider-auth.ts server/providers/catalog-cache.ts
git commit -m "feat: add provider auth resolution and catalog cache"
```

---

## Task 7: OpenRouter Plugin (Full) and Stream Resolver

**Files:**
- Modify: `server/providers/plugins/openrouter.ts` (replace stub)
- Create: `server/providers/stream-resolver.ts`

- [ ] **Step 1: Write the full OpenRouter plugin**

Replace `server/providers/plugins/openrouter.ts` with:

```ts
import { definePluginEntry } from '../../../shared/plugin-sdk';
import type { DiscoveredModelMetadata } from '../../../shared/agent-config';
import type { ProviderModelMap } from '../../../shared/model-catalog';

function mapOpenRouterModel(entry: any): DiscoveredModelMetadata {
  return {
    id: entry.id,
    provider: 'openrouter',
    name: entry.name,
    description: entry.description,
    reasoningSupported:
      Array.isArray(entry.supported_parameters) &&
      entry.supported_parameters.includes('reasoning'),
    inputModalities: entry.architecture?.input_modalities ?? ['text'],
    contextWindow: entry.context_length,
    maxTokens: entry.top_provider?.max_completion_tokens,
    cost: {
      input: Number(entry.pricing?.prompt ?? 0),
      output: Number(entry.pricing?.completion ?? 0),
      cacheRead: Number(entry.pricing?.cache_read ?? 0),
      cacheWrite: Number(entry.pricing?.cache_write ?? 0),
    },
    outputModalities: entry.architecture?.output_modalities ?? ['text'],
    tokenizer: entry.architecture?.tokenizer ?? undefined,
    supportedParameters: Array.isArray(entry.supported_parameters)
      ? entry.supported_parameters
      : undefined,
    topProvider: entry.top_provider
      ? {
          contextLength: entry.top_provider.context_length,
          maxCompletionTokens: entry.top_provider.max_completion_tokens,
          isModerated: entry.top_provider.is_moderated,
        }
      : undefined,
    raw: entry,
  };
}

export const openrouterPlugin = definePluginEntry({
  id: 'openrouter',
  name: 'OpenRouter',
  description: 'Access 200+ models through OpenRouter',
  runtimeProviderId: 'openrouter',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  auth: [
    {
      methodId: 'api-key',
      label: 'API Key',
      type: 'api-key',
      envVar: 'OPENROUTER_API_KEY',
      usesSavedKey: true,
      validate: async (key, baseUrl, signal) => {
        const url = `${baseUrl}/models?limit=1`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal,
        });
        return res.ok;
      },
    },
  ],
  catalog: {
    refresh: async (ctx) => {
      const [fullResponse, userResponse] = await Promise.all([
        fetch(`${ctx.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${ctx.apiKey}` },
          signal: ctx.signal,
        }),
        fetch(`${ctx.baseUrl}/models/user`, {
          headers: { Authorization: `Bearer ${ctx.apiKey}` },
          signal: ctx.signal,
        }),
      ]);

      if (!fullResponse.ok) {
        throw new Error(`OpenRouter model fetch failed: ${fullResponse.status}`);
      }

      const fullBody = await fullResponse.json();
      const models = Object.fromEntries(
        (fullBody.data ?? []).map((entry: any) => {
          const model = mapOpenRouterModel(entry);
          return [model.id, model];
        }),
      ) as ProviderModelMap;

      let userModels: ProviderModelMap = {};
      if (userResponse.ok) {
        const userBody = await userResponse.json();
        userModels = Object.fromEntries(
          (userBody.data ?? []).map((entry: any) => {
            const fullModel = models[entry.id];
            const model = fullModel ?? mapOpenRouterModel(entry);
            return [model.id, model];
          }),
        ) as ProviderModelMap;
      }

      return { models, userModels };
    },
  },
  streamFamily: 'openrouter-thinking',
  // wrapStreamFn, webSearch, webFetch — deferred to a follow-up when
  // the actual stream wrapper infrastructure is connected to pi-agent-core
});
```

- [ ] **Step 2: Create `server/providers/stream-resolver.ts`**

```ts
import type { ProviderPluginDefinition } from '../../shared/plugin-sdk';
import type { ProviderWrapStreamFnContext, StreamFn } from '../../shared/plugin-sdk';

/**
 * Resolve the composed StreamFn for a provider plugin.
 *
 * Resolution order:
 * 1. Start with base StreamFn (undefined = pi-agent-core default)
 * 2. If plugin has streamFamily, apply family hooks (future)
 * 3. If plugin has custom wrapStreamFn, apply it
 * 4. Return composed StreamFn
 */
export function resolveProviderStreamFn(
  plugin: ProviderPluginDefinition,
  ctx: ProviderWrapStreamFnContext,
): StreamFn | undefined {
  let streamFn = ctx.streamFn;

  // streamFamily hooks would be applied here once buildProviderStreamFamilyHooks()
  // is ported from OpenClaw. For v1 this is a pass-through.

  if (plugin.wrapStreamFn) {
    streamFn = plugin.wrapStreamFn({ ...ctx, streamFn });
  }

  return streamFn;
}
```

- [ ] **Step 3: Commit**

```bash
git add server/providers/plugins/openrouter.ts server/providers/stream-resolver.ts
git commit -m "feat: implement OpenRouter plugin and stream resolver"
```

---

## Task 8: Server Integration — Routes, Runtime, Manager

**Files:**
- Modify: `server/index.ts`
- Modify: `server/runtime/model-resolver.ts`
- Modify: `server/runtime/agent-runtime.ts`
- Modify: `server/agents/agent-manager.ts`
- Modify: `server/hooks/hook-types.ts`
- Modify: `server/agents/run-coordinator.ts`
- Delete: `server/runtime/openrouter-model-catalog-store.ts`
- Delete: `server/runtime/openrouter-model-catalog-store.test.ts`

- [ ] **Step 1: Update `server/runtime/model-resolver.ts`**

Change `ResolveRuntimeModelArgs` to accept structured provider config:

```ts
import { getModel, getModels } from '@mariozechner/pi-ai';
import type { Api, Model } from '@mariozechner/pi-ai';
import type {
  DiscoveredModelMetadata,
  ModelCapabilityOverrides,
  ResolvedProviderConfig,
} from '../../shared/agent-config';

interface ResolveRuntimeModelArgs {
  provider: ResolvedProviderConfig;
  runtimeProviderId: string;
  modelId: string;
  modelCapabilities: ModelCapabilityOverrides;
  baseUrl?: string;
  getDiscoveredModel: (
    provider: string,
    modelId: string,
  ) => DiscoveredModelMetadata | undefined;
}

function applyCapabilityOverrides(
  model: Model<Api>,
  overrides: ModelCapabilityOverrides,
): Model<Api> {
  return {
    ...model,
    reasoning: overrides.reasoningSupported ?? model.reasoning,
    input: overrides.inputModalities ?? model.input,
    contextWindow: overrides.contextWindow ?? model.contextWindow,
    maxTokens: overrides.maxTokens ?? model.maxTokens,
    cost: overrides.cost ?? model.cost,
  };
}

export function resolveRuntimeModel(args: ResolveRuntimeModelArgs): Model<Api> {
  const pid = args.runtimeProviderId;

  const builtIn = (
    getModel as (provider: string, modelId: string) => Model<Api> | undefined
  )(pid, args.modelId);

  if (builtIn) {
    const model = applyCapabilityOverrides(builtIn, args.modelCapabilities);
    if (args.baseUrl) {
      return { ...model, baseUrl: args.baseUrl };
    }
    return model;
  }

  const discovered = args.getDiscoveredModel(pid, args.modelId);
  const template = (
    getModels as (provider: string) => Model<Api>[]
  )(pid)[0];

  if (!template) {
    throw new Error(`No model template available for provider: ${pid}`);
  }

  const model = applyCapabilityOverrides(
    {
      ...template,
      id: args.modelId,
      name: args.modelId,
      reasoning: discovered?.reasoningSupported ?? false,
      input: discovered?.inputModalities ?? template.input,
      contextWindow: discovered?.contextWindow ?? template.contextWindow,
      maxTokens: discovered?.maxTokens ?? template.maxTokens,
      cost: discovered?.cost ?? template.cost,
    },
    args.modelCapabilities,
  );

  if (args.baseUrl) {
    return { ...model, baseUrl: args.baseUrl };
  }
  return model;
}
```

- [ ] **Step 2: Update `server/runtime/agent-runtime.ts`**

Update the constructor to accept a plugin registry and resolve provider auth/stream through it.

Change constructor signature (lines 61-66):

```ts
import type { ProviderPluginRegistry } from '../providers/plugin-registry';
import { resolveProviderRuntimeAuth } from '../providers/provider-auth';
import { resolveProviderStreamFn } from '../providers/stream-resolver';

// In the constructor, change:
  constructor(
    config: AgentConfig,
    getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
    getDiscoveredModel?: (provider: string, modelId: string) => DiscoveredModelMetadata | undefined,
    hookRegistry?: HookRegistry,
    private readonly pluginRegistry?: ProviderPluginRegistry,
  ) {
```

Update model resolution (lines 97-102) to use structured provider:

```ts
    const plugin = this.pluginRegistry?.get(config.provider.pluginId);
    const runtimeProviderId = plugin?.runtimeProviderId ?? config.provider.pluginId;

    const model = resolveRuntimeModel({
      provider: config.provider,
      runtimeProviderId,
      modelId: config.modelId,
      modelCapabilities: config.modelCapabilities,
      getDiscoveredModel: this.getDiscoveredModelFn,
    });
```

Update the `getApiKey` callback passed to `new Agent(...)` (line 117). The `getApiKey` callback expects a provider string — pass `runtimeProviderId`:

```ts
      getApiKey: (provider) => getApiKey(provider),
```

No change needed here — the existing `getApiKey` callback already takes a provider string and delegates to `ApiKeyStore.get(provider)`.

Update `setModel` (lines 140-150) to accept structured config:

```ts
  setModel(runtimeProviderId: string, modelId: string): void {
    const model = resolveRuntimeModel({
      provider: this.config.provider,
      runtimeProviderId,
      modelId,
      modelCapabilities: this.config.modelCapabilities,
      getDiscoveredModel: this.getDiscoveredModelFn,
    });

    this.agent.state.model = model;
    log('AgentRuntime', `Model swapped to ${runtimeProviderId}/${modelId}`);
  }
```

- [ ] **Step 3: Update `server/agents/agent-manager.ts`**

Add plugin registry as a dependency:

```ts
import { ProviderPluginRegistry } from '../providers/plugin-registry';
```

Update constructor and `start()`:

```ts
export class AgentManager {
  private agents = new Map<string, ManagedAgent>();

  constructor(
    private readonly apiKeys: ApiKeyStore,
    private readonly pluginRegistry: ProviderPluginRegistry,
  ) {}

  async start(config: AgentConfig): Promise<void> {
    // ... existing code ...

    // Create runtime with plugin registry
    const runtime = new AgentRuntime(
      config,
      (provider) => Promise.resolve(this.apiKeys.get(provider)),
      undefined,
      hooks,
      this.pluginRegistry,
    );

    // ... rest unchanged ...
  }
```

- [ ] **Step 4: Update `server/hooks/hook-types.ts`**

Change `BeforeModelResolveContext.overrides.provider` from `string` to `string | undefined` (it already is optional, but clarify it refers to `runtimeProviderId` now):

```ts
export interface BeforeModelResolveContext {
  agentId: string;
  runId: string;
  sessionId: string;
  config: Readonly<AgentConfig>;
  overrides: {
    provider?: string; // runtimeProviderId, not pluginId
    modelId?: string;
  };
}
```

This is already compatible — the hook passes a string to `runtime.setModel(provider, modelId)` which now takes `runtimeProviderId`.

- [ ] **Step 5: Update `server/agents/run-coordinator.ts`**

In `executeRun` (around line 492-496), update the provider override resolution:

```ts
        if (modelCtx.overrides.provider || modelCtx.overrides.modelId) {
          const provider = modelCtx.overrides.provider ?? this.config.provider.pluginId;
          const modelId = modelCtx.overrides.modelId ?? this.config.modelId;
          this.runtime.setModel(provider, modelId);
        }
```

Search for any other references to `this.config.provider` as a string and update them. The session routing in `resolveSession` passes `config.provider` to `SessionRouteRequest.provider` — update to pass `config.provider.pluginId`:

Find the line that sets `provider` on the session route request and change it to `this.config.provider.pluginId`.

- [ ] **Step 6: Update `server/index.ts`**

Replace the OpenRouter catalog imports and routes with the plugin system:

At the top, replace:

```ts
import { OpenRouterModelCatalogStore } from './runtime/openrouter-model-catalog-store';
```

with:

```ts
import { ProviderPluginRegistry } from './providers/plugin-registry';
import { ProviderCatalogCache, type ProviderCatalogRequest } from './providers/catalog-cache';
import { loadProviderPlugins } from './providers/provider-loader';
import { resolveProviderRuntimeAuth } from './providers/provider-auth';
import path from 'path';
```

Replace:

```ts
const modelCatalogStore = new OpenRouterModelCatalogStore();
```

with:

```ts
const pluginRegistry = new ProviderPluginRegistry();
const catalogCache = new ProviderCatalogCache();
```

Update `agentManager` initialization:

```ts
const agentManager = new AgentManager(apiKeys, pluginRegistry);
```

Replace the three OpenRouter catalog routes (lines 398-428) with:

```ts
// --- Provider registry ---

app.get('/api/providers', (_req, res) => {
  res.json(pluginRegistry.listSummaries());
});

// --- Provider catalog ---

app.post('/api/providers/catalog/load', async (req, res) => {
  const { request, apiKeyFingerprint } = req.body as {
    request: ProviderCatalogRequest;
    apiKeyFingerprint?: string;
  };
  try {
    const cached = await catalogCache.load(request, apiKeyFingerprint);
    if (cached) {
      res.json(cached);
    } else {
      // No cache — try to refresh if we have a key
      const plugin = pluginRegistry.get(request.pluginId);
      if (!plugin?.catalog) {
        res.json({ models: {}, userModels: {}, syncedAt: null, userModelsRequireRefresh: false });
        return;
      }
      const apiKey = apiKeys.get(plugin.id);
      if (!apiKey) {
        res.json({ models: {}, userModels: {}, syncedAt: null, userModelsRequireRefresh: false });
        return;
      }
      const auth = resolveProviderRuntimeAuth(
        { pluginId: request.pluginId, authMethodId: request.authMethodId, envVar: request.envVar, baseUrl: request.baseUrl },
        plugin,
        apiKeys,
      );
      res.json(await catalogCache.refresh(request, plugin, {
        apiKey: auth.apiKey!,
        baseUrl: auth.baseUrl,
      }));
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/providers/catalog/refresh', async (req, res) => {
  const { request } = req.body as { request: ProviderCatalogRequest };
  try {
    const plugin = pluginRegistry.get(request.pluginId);
    if (!plugin?.catalog) {
      res.status(400).json({ error: `Plugin "${request.pluginId}" has no catalog.` });
      return;
    }
    const auth = resolveProviderRuntimeAuth(
      { pluginId: request.pluginId, authMethodId: request.authMethodId, envVar: request.envVar, baseUrl: request.baseUrl },
      plugin,
      apiKeys,
    );
    if (!auth.apiKey) {
      res.status(400).json({ error: `No API key available for "${request.pluginId}".` });
      return;
    }
    res.json(await catalogCache.refresh(request, plugin, {
      apiKey: auth.apiKey,
      baseUrl: auth.baseUrl,
    }));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/providers/catalog/clear', async (req, res) => {
  const { request } = req.body as { request?: ProviderCatalogRequest };
  try {
    if (request) {
      await catalogCache.clear(request);
    } else {
      await catalogCache.clearAll();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

Add plugin loading at startup. After the `settingsFile.load()` call (around line 452), add:

```ts
// Load provider plugins
loadProviderPlugins(
  path.join(process.cwd(), 'providers.json'),
  pluginRegistry,
).then(() => {
  console.log(`[Providers] ${pluginRegistry.list().length} provider(s) available.`);
}).catch((err) => {
  console.error('[Providers] Failed to load plugins:', err);
});
```

- [ ] **Step 7: Delete old files**

```bash
git rm server/runtime/openrouter-model-catalog-store.ts
git rm server/runtime/openrouter-model-catalog-store.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add server/ shared/
git commit -m "feat: integrate provider plugin system into server runtime and routes"
```

---

## Task 9: Provider Node UI Component

**Files:**
- Create: `src/nodes/ProviderNode.tsx`
- Modify: `src/nodes/node-registry.ts`
- Modify: `src/panels/Sidebar.tsx`

- [ ] **Step 1: Create `src/nodes/ProviderNode.tsx`**

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { ProviderNodeData } from '../types/nodes';
import { NODE_COLORS } from '../utils/theme';

export default function ProviderNode({ data }: NodeProps) {
  const d = data as unknown as ProviderNodeData;
  const color = NODE_COLORS.provider;

  return (
    <div
      className="rounded-xl border bg-slate-900 shadow-lg"
      style={{ borderColor: color, minWidth: 180 }}
    >
      <div
        className="rounded-t-xl px-3 py-1.5 text-xs font-semibold text-white"
        style={{ backgroundColor: color }}
      >
        Provider
      </div>
      <div className="space-y-1 px-3 py-2">
        <div className="text-sm font-medium text-slate-100">{d.label}</div>
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
            {d.pluginId || 'none'}
          </span>
          {d.baseUrl && (
            <span className="truncate text-[10px] text-slate-500" title={d.baseUrl}>
              {d.baseUrl}
            </span>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-slate-500" />
    </div>
  );
}
```

- [ ] **Step 2: Register in `src/nodes/node-registry.ts`**

Add import:

```ts
import ProviderNode from './ProviderNode';
```

Add to the registry object:

```ts
  provider: ProviderNode,
```

- [ ] **Step 3: Add to sidebar palette in `src/panels/Sidebar.tsx`**

Add `'provider'` to the `PERIPHERAL_ITEMS` array (after storage or before the array's closing bracket):

```ts
  { type: 'provider' as NodeType },
```

- [ ] **Step 4: Commit**

```bash
git add src/nodes/ProviderNode.tsx src/nodes/node-registry.ts src/panels/Sidebar.tsx
git commit -m "feat: add Provider node component and register in sidebar"
```

---

## Task 10: Provider Properties Editor

**Files:**
- Create: `src/panels/property-editors/ProviderProperties.tsx`
- Create: `src/store/provider-registry-store.ts`
- Modify: `src/panels/PropertiesPanel.tsx`

- [ ] **Step 1: Create `src/store/provider-registry-store.ts`**

```ts
import { create } from 'zustand';
import type { ProviderPluginSummary } from '../../shared/plugin-sdk';

interface ProviderRegistryState {
  providers: ProviderPluginSummary[];
  loading: boolean;
  error: string | null;
  loadProviders: () => Promise<void>;
  getProvider: (pluginId: string) => ProviderPluginSummary | undefined;
}

export const useProviderRegistryStore = create<ProviderRegistryState>(
  (set, get) => ({
    providers: [],
    loading: false,
    error: null,

    loadProviders: async () => {
      set({ loading: true, error: null });
      try {
        const res = await fetch('/api/providers');
        if (!res.ok) throw new Error(`Failed to load providers: ${res.status}`);
        const providers = (await res.json()) as ProviderPluginSummary[];
        set({ providers, loading: false });
      } catch (err) {
        set({ error: (err as Error).message, loading: false });
      }
    },

    getProvider: (pluginId: string) => {
      return get().providers.find((p) => p.id === pluginId);
    },
  }),
);
```

- [ ] **Step 2: Create `src/panels/property-editors/ProviderProperties.tsx`**

```tsx
import type { ProviderNodeData } from '../../types/nodes';
import { useProviderRegistryStore } from '../../store/provider-registry-store';

interface ProviderPropertiesProps {
  data: ProviderNodeData;
  onChange: (updates: Partial<ProviderNodeData>) => void;
}

export default function ProviderProperties({
  data,
  onChange,
}: ProviderPropertiesProps) {
  const providers = useProviderRegistryStore((s) => s.providers);
  const currentPlugin = providers.find((p) => p.id === data.pluginId);
  const authMethods = currentPlugin?.auth ?? [];
  const currentAuth = authMethods.find((a) => a.methodId === data.authMethodId);

  return (
    <div className="space-y-4">
      {/* Label */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Label
        </span>
        <input
          type="text"
          value={data.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
        />
      </label>

      {/* Provider plugin selector */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Provider
        </span>
        <select
          value={data.pluginId}
          onChange={(e) => {
            const newPlugin = providers.find((p) => p.id === e.target.value);
            const defaultAuth = newPlugin?.auth[0];
            onChange({
              pluginId: e.target.value,
              authMethodId: defaultAuth?.methodId ?? '',
              envVar: defaultAuth?.envVar ?? '',
              baseUrl: '',
            });
          }}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {/* Auth method selector (if multiple) */}
      {authMethods.length > 1 && (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-300">
            Auth Method
          </span>
          <select
            value={data.authMethodId}
            onChange={(e) => {
              const auth = authMethods.find(
                (a) => a.methodId === e.target.value,
              );
              onChange({
                authMethodId: e.target.value,
                envVar: auth?.envVar ?? data.envVar,
              });
            }}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-blue-500 focus:outline-none"
          >
            {authMethods.map((a) => (
              <option key={a.methodId} value={a.methodId}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Env var */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Environment Variable
        </span>
        <input
          type="text"
          value={data.envVar}
          onChange={(e) => onChange({ envVar: e.target.value })}
          placeholder={currentAuth?.envVar ?? 'e.g. OPENROUTER_API_KEY'}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">
          Fallback environment variable name for the API key.
        </p>
      </label>

      {/* Base URL override */}
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-300">
          Base URL Override
        </span>
        <input
          type="text"
          value={data.baseUrl}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          placeholder={currentPlugin?.defaultBaseUrl ?? 'Leave empty for default'}
          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-500">
          Leave empty to use the provider's default URL
          {currentPlugin?.defaultBaseUrl
            ? ` (${currentPlugin.defaultBaseUrl})`
            : ''}
          .
        </p>
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Route provider type in `src/panels/PropertiesPanel.tsx`**

Add import:

```ts
import ProviderProperties from './property-editors/ProviderProperties';
```

Add case in `PropertyEditorForType` (after the last existing case):

```ts
    case 'provider':
      return <ProviderProperties data={node.data as any} onChange={onChange} />;
```

- [ ] **Step 4: Commit**

```bash
git add src/store/provider-registry-store.ts src/panels/property-editors/ProviderProperties.tsx src/panels/PropertiesPanel.tsx
git commit -m "feat: add provider properties editor and provider registry store"
```

---

## Task 11: Agent Node + Properties — Remove Provider, Derive from Connected Node

**Files:**
- Modify: `src/nodes/AgentNode.tsx`
- Modify: `src/panels/property-editors/AgentProperties.tsx`
- Modify: `src/chat/ChatDrawer.tsx`

- [ ] **Step 1: Update `src/nodes/AgentNode.tsx` provider badge**

The badge currently reads `data.provider`. Change it to derive from connected Provider node.

Replace the provider badge section (around lines 64-71) with a helper that finds the connected provider:

```tsx
import { useGraphStore } from '../store/graph-store';

// Inside the component:
  const edges = useGraphStore((s) => s.edges);
  const nodes = useGraphStore((s) => s.nodes);

  const connectedProviderNode = useMemo(() => {
    const incomingEdges = edges.filter((e) => e.target === id);
    for (const edge of incomingEdges) {
      const source = nodes.find((n) => n.id === edge.source);
      if (source?.data.type === 'provider') return source.data;
    }
    return null;
  }, [edges, nodes, id]);

  const providerLabel = connectedProviderNode
    ? (connectedProviderNode as any).pluginId
    : 'no provider';
```

Replace the badge JSX to use `providerLabel` instead of `data.provider`.

- [ ] **Step 2: Update `src/panels/property-editors/AgentProperties.tsx`**

Remove the provider `<select>` (around lines 240-275). The agent no longer picks a provider directly.

Update model picker to derive available models from the connected Provider node's catalog. Add a helper to find the connected provider's `pluginId`:

```tsx
import { useGraphStore } from '../../store/graph-store';

// Inside the component:
  const edges = useGraphStore((s) => s.edges);
  const allNodes = useGraphStore((s) => s.nodes);

  const connectedPluginId = useMemo(() => {
    const incomingEdges = edges.filter((e) => e.target === nodeId);
    for (const edge of incomingEdges) {
      const source = allNodes.find((n) => n.id === edge.source);
      if (source?.data.type === 'provider') {
        return (source.data as any).pluginId as string;
      }
    }
    return '';
  }, [edges, allNodes, nodeId]);
```

Use `connectedPluginId` instead of `data.provider` when fetching models from the catalog store.

- [ ] **Step 3: Update `src/chat/ChatDrawer.tsx`**

Add missing-provider validation to the `missingPeripherals` check. After the storage check (around line 279), add:

```ts
  // Check for Provider node
  const hasProvider = connectedNodes.some((n) => n.data.type === 'provider');
  if (!hasProvider) {
    return 'Connect a Provider node to this agent to enable chat.';
  }
```

Update the session creation (line 141) where `config.provider` is used — it's now `ResolvedProviderConfig`, so change to `config.provider.pluginId` where a string is expected.

Update the header display (lines 316-317) from `config.provider` to `config.provider.pluginId`.

- [ ] **Step 4: Commit**

```bash
git add src/nodes/AgentNode.tsx src/panels/property-editors/AgentProperties.tsx src/chat/ChatDrawer.tsx
git commit -m "feat: derive provider from connected node in agent UI and chat"
```

---

## Task 12: Settings Updates — Defaults, Catalog, API Keys

**Files:**
- Modify: `src/settings/types.ts`
- Modify: `src/settings/settings-store.ts`
- Modify: `src/settings/sections/DefaultsSection.tsx`
- Modify: `src/settings/sections/ModelCatalogSection.tsx`
- Modify: `src/settings/sections/ProvidersApiKeysSection.tsx`
- Modify: `src/settings/sections/DataMaintenanceSection.tsx`

- [ ] **Step 1: Add `ProviderDefaults` to `src/settings/types.ts`**

Add after `AgentDefaults`:

```ts
export interface ProviderDefaults {
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string;
}
```

Remove `provider` from `AgentDefaults` interface (line 15).

Add default values:

```ts
export const DEFAULT_PROVIDER_DEFAULTS: ProviderDefaults = {
  pluginId: 'openrouter',
  authMethodId: 'api-key',
  envVar: 'OPENROUTER_API_KEY',
  baseUrl: '',
};
```

Remove `provider: 'openrouter'` from `DEFAULT_AGENT_DEFAULTS`.

- [ ] **Step 2: Update `src/settings/settings-store.ts`**

Add `providerDefaults` to `PersistedSettings` and `SettingsStore`:

```ts
import type { ProviderDefaults } from './types';
import { DEFAULT_PROVIDER_DEFAULTS } from './types';
```

Add to `PersistedSettings`:

```ts
  providerDefaults: ProviderDefaults;
```

Add store action:

```ts
  setProviderDefaults: (defaults: Partial<ProviderDefaults>) => void;
```

Add getter in store state:

```ts
  providerDefaults: DEFAULT_PROVIDER_DEFAULTS,
```

Add setter implementation:

```ts
  setProviderDefaults: (updates) => {
    const current = get().providerDefaults;
    const merged = { ...current, ...updates };
    set({ providerDefaults: merged });
    saveSettings({ ...buildPersistedSettings(get()), providerDefaults: merged });
  },
```

- [ ] **Step 3: Update `src/store/graph-store.ts` `buildNodeData()`**

Add provider defaults to the builder (around line 23-88). Add a case for `'provider'`:

```ts
  if (nodeType === 'provider' && defaults.type === 'provider') {
    const providerDefaults = useSettingsStore.getState().providerDefaults;
    return {
      ...defaults,
      pluginId: providerDefaults.pluginId,
      authMethodId: providerDefaults.authMethodId,
      envVar: providerDefaults.envVar,
      baseUrl: providerDefaults.baseUrl,
    };
  }
```

Remove `provider: agentDefaults.provider` from the agent case (line 30).

- [ ] **Step 4: Update `DefaultsSection.tsx`**

In `AgentSubSection`, remove the provider selector (lines 69-86). Add a new "Provider" sub-tab or a separate `ProviderSubSection` component using the `providerDefaults` from settings store with a plugin selector driven by `useProviderRegistryStore`.

- [ ] **Step 5: Update `ProvidersApiKeysSection.tsx`**

Replace the hardcoded `PROVIDERS` array with data from the provider registry store. Keep the existing providers that aren't plugin-managed (they're still valid API key targets for pi-ai). Add an `isPluginProvider` indicator using the registry.

- [ ] **Step 6: Update `ModelCatalogSection.tsx`**

Replace hardcoded `openrouter` references with the provider from connected context. The catalog load/refresh calls should use the new `/api/providers/catalog/*` routes with `ProviderCatalogRequest` payloads.

- [ ] **Step 7: Update `DataMaintenanceSection.tsx`**

Replace the OpenRouter-specific catalog clear with a generic clear-all:

```ts
await fetch('/api/providers/catalog/clear', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
```

- [ ] **Step 8: Commit**

```bash
git add src/settings/ src/store/graph-store.ts
git commit -m "feat: update settings for provider defaults and registry-driven UI"
```

---

## Task 13: Model Catalog Store Generalization

**Files:**
- Modify: `src/store/model-catalog-store.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Generalize `src/store/model-catalog-store.ts`**

Replace the OpenRouter-specific store with provider-instance keyed state:

```ts
import { create } from 'zustand';
import type { ProviderModelMap, ProviderCatalogResponse } from '../../shared/model-catalog';
import type { ProviderCatalogRequest } from '../../shared/plugin-sdk';

function catalogKey(request: ProviderCatalogRequest): string {
  return `${request.pluginId}::${request.baseUrl || 'default'}`;
}

interface ModelCatalogState {
  models: Record<string, ProviderModelMap>;
  userModels: Record<string, ProviderModelMap>;
  syncedAt: Record<string, string | null>;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;

  loadCatalog: (request: ProviderCatalogRequest) => Promise<void>;
  refreshCatalog: (request: ProviderCatalogRequest) => Promise<void>;
  clearCatalog: (request: ProviderCatalogRequest) => Promise<void>;
  clearAllCatalogs: () => Promise<void>;
  getProviderModels: (key: string) => ProviderModelMap;
  getModelMetadata: (key: string, modelId: string) => import('../../shared/agent-config').DiscoveredModelMetadata | undefined;

  // Legacy convenience methods for backward compat during migration
  loadOpenRouterCatalog: () => Promise<void>;
  refreshOpenRouterCatalog: () => Promise<void>;
  clearOpenRouterCatalog: () => Promise<void>;
}

const DEFAULT_OPENROUTER_REQUEST: ProviderCatalogRequest = {
  pluginId: 'openrouter',
  authMethodId: 'api-key',
  envVar: 'OPENROUTER_API_KEY',
  baseUrl: '',
};

function applyCatalogResponse(
  state: ModelCatalogState,
  key: string,
  response: ProviderCatalogResponse,
): Partial<ModelCatalogState> {
  return {
    models: { ...state.models, [key]: response.models },
    userModels: { ...state.userModels, [key]: response.userModels },
    syncedAt: { ...state.syncedAt, [key]: response.syncedAt },
    loading: { ...state.loading, [key]: false },
    errors: { ...state.errors, [key]: null },
  };
}

export const useModelCatalogStore = create<ModelCatalogState>((set, get) => ({
  models: {},
  userModels: {},
  syncedAt: {},
  loading: {},
  errors: {},

  loadCatalog: async (request) => {
    const key = catalogKey(request);
    set((s) => ({ loading: { ...s.loading, [key]: true } }));
    try {
      const res = await fetch('/api/providers/catalog/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request }),
      });
      if (!res.ok) throw new Error(`Catalog load failed: ${res.status}`);
      const data = (await res.json()) as ProviderCatalogResponse;
      set((s) => applyCatalogResponse(s, key, data));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
    }
  },

  refreshCatalog: async (request) => {
    const key = catalogKey(request);
    set((s) => ({ loading: { ...s.loading, [key]: true } }));
    try {
      const res = await fetch('/api/providers/catalog/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request }),
      });
      if (!res.ok) throw new Error(`Catalog refresh failed: ${res.status}`);
      const data = (await res.json()) as ProviderCatalogResponse;
      set((s) => applyCatalogResponse(s, key, data));
    } catch (err) {
      set((s) => ({
        loading: { ...s.loading, [key]: false },
        errors: { ...s.errors, [key]: (err as Error).message },
      }));
    }
  },

  clearCatalog: async (request) => {
    const key = catalogKey(request);
    await fetch('/api/providers/catalog/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request }),
    });
    set((s) => ({
      models: { ...s.models, [key]: {} },
      userModels: { ...s.userModels, [key]: {} },
      syncedAt: { ...s.syncedAt, [key]: null },
    }));
  },

  clearAllCatalogs: async () => {
    await fetch('/api/providers/catalog/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    set({ models: {}, userModels: {}, syncedAt: {} });
  },

  getProviderModels: (key) => get().models[key] ?? {},
  getModelMetadata: (key, modelId) => get().models[key]?.[modelId],

  // Legacy convenience wrappers
  loadOpenRouterCatalog: async () => get().loadCatalog(DEFAULT_OPENROUTER_REQUEST),
  refreshOpenRouterCatalog: async () => get().refreshCatalog(DEFAULT_OPENROUTER_REQUEST),
  clearOpenRouterCatalog: async () => get().clearCatalog(DEFAULT_OPENROUTER_REQUEST),
}));
```

- [ ] **Step 2: Update `src/App.tsx`**

Add provider registry loading on mount:

```ts
import { useProviderRegistryStore } from './store/provider-registry-store';
```

In the initial `useEffect` (around line 29), add:

```ts
  useProviderRegistryStore.getState().loadProviders();
```

Update the catalog loading (around line 44-50) to use the new API:

```ts
  useEffect(() => {
    if (settingsLoaded && openRouterKey) {
      useModelCatalogStore.getState().loadOpenRouterCatalog();
    }
  }, [settingsLoaded, openRouterKey]);
```

This uses the legacy wrapper which internally routes through the new API.

- [ ] **Step 3: Commit**

```bash
git add src/store/model-catalog-store.ts src/App.tsx
git commit -m "feat: generalize model catalog store for provider-instance keyed state"
```

---

## Task 14: Export/Import, Fixture, and Concept Docs

**Files:**
- Modify: `src/utils/export-import.ts`
- Modify: `src/fixtures/test-graph.json`
- Modify: `docs/concepts/_manifest.json`
- Create: `docs/concepts/provider-node.md`
- Modify: `docs/concepts/agent-node.md`

- [ ] **Step 1: Update `src/utils/export-import.ts`**

In the `importGraph()` function, the migration logic (around lines 56-71) should handle old graphs that have `provider` on agent nodes. Add migration:

```ts
// Migrate old agent nodes that have provider as a string
if (node.data.type === 'agent' && 'provider' in node.data) {
  delete (node.data as any).provider;
}
```

The function already applies `getDefaultNodeData()` defaults, which will handle the new provider node type.

- [ ] **Step 2: Update `src/fixtures/test-graph.json`**

Add a Provider node and edge. Remove `provider` from the agent data:

In agent-1 data, remove `"provider": "anthropic"`.

Add a provider node to the nodes array:

```json
{
  "id": "provider-1",
  "type": "provider",
  "position": { "x": 100, "y": 660 },
  "data": {
    "type": "provider",
    "label": "OpenRouter",
    "pluginId": "openrouter",
    "authMethodId": "api-key",
    "envVar": "OPENROUTER_API_KEY",
    "baseUrl": ""
  }
}
```

Add a provider edge:

```json
{
  "id": "edge_provider-1_agent-1",
  "source": "provider-1",
  "target": "agent-1",
  "type": "data",
  "animated": true
}
```

- [ ] **Step 3: Update `docs/concepts/_manifest.json`**

Add provider entry:

```json
    "provider": {
      "doc": "provider-node.md",
      "type": "src/types/nodes.ts#ProviderNodeData",
      "runtime": "server/providers/plugin-registry.ts"
    }
```

- [ ] **Step 4: Create `docs/concepts/provider-node.md`**

```md
<!-- last-verified: 2026-04-10 -->
# Provider Node

The Provider node is a peripheral node that connects to an agent node and owns the provider identity, auth method, environment variable name, and optional base URL override.

## Purpose

Decouples model provider configuration from the agent node, enabling modular provider plugins. Each provider is a plugin that registers through the provider plugin SDK.

## Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `pluginId` | `string` | `'openrouter'` | Which provider plugin to use |
| `authMethodId` | `string` | `'api-key'` | Auth method within the plugin |
| `envVar` | `string` | `'OPENROUTER_API_KEY'` | Env var name for API key fallback |
| `baseUrl` | `string` | `''` | Optional base URL override; empty = plugin default |

## Runtime Behavior

- The browser passes raw node data to `resolveAgentConfig()`, which builds a `ResolvedProviderConfig`
- The server resolves the actual API key (saved key > env var) and base URL (override > plugin default) at runtime
- Provider plugins are loaded from `providers.json` at server startup
- Each provider plugin defines its catalog refresh, stream wrappers, and web tool implementations
- Model catalogs are cached per provider instance (pluginId + normalized baseUrl)

## Connections

- Connects **to** an agent node (peripheral → agent)
- Each agent must have exactly **one** connected Provider node to run
- Does not connect to other peripheral nodes

## Validation

- Missing Provider node: blocks runtime start, chat, and provider-dependent model picking
- Duplicate Provider nodes: blocks runtime start
- Empty pluginId: blocks runtime start
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/export-import.ts src/fixtures/test-graph.json docs/concepts/
git commit -m "feat: update fixture, export/import, and concept docs for Provider node"
```

---

## Task 15: Test Updates

**Files:**
- Modify: `src/utils/graph-to-agent.test.ts` (already partially done in Task 4)
- Modify: `src/store/graph-store.test.ts`
- Modify: `src/store/model-catalog-store.test.ts`
- Modify: `server/runtime/model-resolver.test.ts`
- Modify: `server/runtime/agent-runtime.test.ts`
- Modify: `server/agents/agent-manager.test.ts`
- Modify: `server/agents/run-coordinator.test.ts`

- [ ] **Step 1: Update `server/runtime/model-resolver.test.ts`**

Update all calls to `resolveRuntimeModel()` to pass structured `provider` and `runtimeProviderId` instead of `provider: 'openai'`:

```ts
resolveRuntimeModel({
  provider: { pluginId: 'openai', authMethodId: 'api-key', envVar: '', baseUrl: '' },
  runtimeProviderId: 'openai',
  modelId: 'gpt-4',
  modelCapabilities: {},
  getDiscoveredModel: () => undefined,
})
```

- [ ] **Step 2: Update `server/runtime/agent-runtime.test.ts`**

Update config factories to use `ResolvedProviderConfig`:

```ts
provider: { pluginId: 'openai', authMethodId: 'api-key', envVar: '', baseUrl: '' },
```

Update any mocks that create `AgentRuntime` to pass a 5th argument (pluginRegistry) or `undefined`.

- [ ] **Step 3: Update `server/agents/agent-manager.test.ts`**

Update `AgentManager` constructor calls to pass a mock `ProviderPluginRegistry`:

```ts
import { ProviderPluginRegistry } from '../providers/plugin-registry';

const registry = new ProviderPluginRegistry();
const manager = new AgentManager(apiKeys, registry);
```

Update config factories to use structured provider.

- [ ] **Step 4: Update `server/agents/run-coordinator.test.ts`**

Update `makeConfig()` to use structured provider:

```ts
provider: { pluginId: 'test', authMethodId: 'api-key', envVar: '', baseUrl: '' },
```

Update any assertions that check `config.provider` as a string.

- [ ] **Step 5: Update `src/store/graph-store.test.ts`**

Update agent node data factories to remove the `provider` field. Update assertions that check `buildNodeData('agent')` to no longer assert a `provider` property.

- [ ] **Step 6: Update `src/store/model-catalog-store.test.ts`**

Update fetch mocks to use the new `/api/providers/catalog/*` routes instead of `/api/model-catalog/openrouter`.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "test: update all tests for provider plugin SDK type changes"
```

---

## Task 16: Tool Factory — Provider Web Tool Replacement

**Files:**
- Modify: `server/runtime/tool-factory.ts`

- [ ] **Step 1: Add provider web tool replacement to `createAgentTools()`**

Update `createAgentTools` to accept an optional provider plugin parameter:

```ts
import type { ProviderPluginDefinition } from '../../shared/plugin-sdk';
import type { WebSearchToolContext, WebFetchToolContext } from '../../shared/plugin-sdk';

export function createAgentTools(
  names: string[],
  extraTools: AgentTool<TSchema>[] = [],
  providerWebContext?: {
    plugin: ProviderPluginDefinition;
    apiKey: string;
    baseUrl: string;
  },
): AgentTool<TSchema>[] {
```

In the tool creation loop, when the name is `web_search` or `web_fetch`, check if the provider plugin has an implementation:

```ts
  if (name === 'web_search' && providerWebContext?.plugin.webSearch) {
    const ctx: WebSearchToolContext = {
      apiKey: providerWebContext.apiKey,
      baseUrl: providerWebContext.baseUrl,
    };
    return providerWebContext.plugin.webSearch.createTool(ctx);
  }

  if (name === 'web_fetch' && providerWebContext?.plugin.webFetch) {
    const ctx: WebFetchToolContext = {
      apiKey: providerWebContext.apiKey,
      baseUrl: providerWebContext.baseUrl,
    };
    return providerWebContext.plugin.webFetch.createTool(ctx);
  }
```

This only replaces the implementation when the tool is already enabled AND the plugin provides one — it does not inject tools the agent hasn't enabled.

- [ ] **Step 2: Commit**

```bash
git add server/runtime/tool-factory.ts
git commit -m "feat: support provider-backed web tool replacement in tool factory"
```

---

## Task 17: Final Integration Test and Cleanup

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose`
Expected: All tests pass.

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run the dev server and verify**

Run: `npm run dev` (or equivalent)
Verify:
- Provider nodes appear in sidebar
- Dragging a provider node and connecting to agent works
- Agent node shows provider badge from connected node
- Provider properties editor shows plugin dropdown
- Settings pages load without errors

- [ ] **Step 4: Final commit with any remaining fixes**

```bash
git add -A
git commit -m "chore: fix remaining type errors and integration issues"
```

- [ ] **Step 5: Update CLAUDE.md if needed**

Add `server/providers/` to the Key Source Files table and update any references to the old `openrouter-model-catalog-store.ts`.
