# Agent Custom Model Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Agent nodes use built-in, discovered, or manually entered provider-supported models, starting with OpenRouter metadata discovery and per-agent capability overrides.

**Architecture:** Add a provider model catalog store for OpenRouter discovery, keep per-agent capability overrides on the Agent node, and centralize runtime model construction in a dedicated resolver. The resolver must merge three sources in order: agent overrides, discovered metadata, and provider fallback templates.

**Tech Stack:** React 19, TypeScript, Vite, Zustand, `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, Vitest, Testing Library

---

## File Structure

### Existing files to modify

- `package.json`
  Responsibility: add test dependencies and scripts.
- `vite.config.ts`
  Responsibility: add Vitest configuration.
- `src/App.tsx`
  Responsibility: trigger OpenRouter metadata sync on startup and on API key changes.
- `src/settings/settings-store.ts`
  Responsibility: keep API key persistence unchanged, expose stable key reads for discovery sync.
- `src/types/nodes.ts`
  Responsibility: add Agent node capability override types.
- `src/runtime/agent-config.ts`
  Responsibility: carry capability override data into runtime config.
- `src/utils/default-nodes.ts`
  Responsibility: seed new Agent node fields with safe defaults.
- `src/utils/graph-to-agent.ts`
  Responsibility: include capability overrides in resolved `AgentConfig`.
- `src/panels/property-editors/AgentProperties.tsx`
  Responsibility: merge built-in and discovered models, support `Custom model...`, and edit per-agent capability overrides.
- `src/runtime/agent-runtime.ts`
  Responsibility: use the new model resolver instead of raw `getModel(...)`.

### New files to create

- `src/test/setup.ts`
  Responsibility: shared Vitest + Testing Library setup.
- `src/types/model-metadata.ts`
  Responsibility: shared types for discovered model metadata, resolved capabilities, and cost/input fields.
- `src/runtime/provider-model-options.ts`
  Responsibility: central static provider list and built-in model options used by the Agent editor.
- `src/store/model-catalog-store.ts`
  Responsibility: OpenRouter model discovery cache, loading/error state, key-based invalidation, and metadata lookup.
- `src/runtime/model-resolver.ts`
  Responsibility: resolve runtime `Model` objects from built-in `pi-ai` models, discovered metadata, and provider fallback templates.
- `src/utils/default-nodes.test.ts`
  Responsibility: verify Agent default data includes the new capability override structure.
- `src/utils/graph-to-agent.test.ts`
  Responsibility: verify Agent node override data survives graph-to-config resolution.
- `src/store/model-catalog-store.test.ts`
  Responsibility: verify OpenRouter discovery fetch, key-change invalidation, and metadata caching behavior.
- `src/runtime/model-resolver.test.ts`
  Responsibility: verify built-in model resolution, discovered metadata synthesis, and provider fallback resolution.
- `src/panels/property-editors/AgentProperties.test.tsx`
  Responsibility: verify model picker behavior, custom model mode, provider reset behavior, and override editing.

## Task 1: Add Test Infrastructure

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `src/test/setup.ts`
- Create: `src/utils/default-nodes.test.ts`

- [ ] **Step 1: Write the initial smoke test**

```ts
import { describe, expect, it } from 'vitest';
import { getDefaultNodeData } from './default-nodes';

describe('getDefaultNodeData', () => {
  it('returns an agent node config', () => {
    const node = getDefaultNodeData('agent');
    expect(node.type).toBe('agent');
    expect(node.provider).toBe('anthropic');
  });
});
```

- [ ] **Step 2: Run the test to verify the toolchain is missing**

Run: `npm run test:run -- src/utils/default-nodes.test.ts`

Expected: FAIL because `test:run` is not defined or `vitest` is not installed yet.

- [ ] **Step 3: Add the minimal test tooling**

Update `package.json`:

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "...",
    "@testing-library/react": "...",
    "@testing-library/user-event": "...",
    "jsdom": "...",
    "vitest": "..."
  }
}
```

Update `vite.config.ts`:

```ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
```

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Run the smoke test to verify the harness works**

Run: `npm run test:run -- src/utils/default-nodes.test.ts`

Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add package.json vite.config.ts src/test/setup.ts src/utils/default-nodes.test.ts
git commit -m "test: add vitest harness"
```

## Task 2: Add Shared Model Metadata Types and Agent Override Plumbing

**Files:**
- Create: `src/types/model-metadata.ts`
- Modify: `src/types/nodes.ts`
- Modify: `src/runtime/agent-config.ts`
- Modify: `src/utils/default-nodes.ts`
- Modify: `src/utils/graph-to-agent.ts`
- Modify: `src/utils/default-nodes.test.ts`
- Create: `src/utils/graph-to-agent.test.ts`

- [ ] **Step 1: Write the failing tests for Agent defaults and graph resolution**

Create `src/utils/graph-to-agent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveAgentConfig } from './graph-to-agent';

describe('resolveAgentConfig', () => {
  it('carries per-agent capability overrides into runtime config', () => {
    const config = resolveAgentConfig('agent-1', [
      {
        id: 'agent-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {
          type: 'agent',
          name: 'Agent',
          systemPrompt: 'Test',
          provider: 'openrouter',
          modelId: 'xiaomi/mimo-v2-pro',
          thinkingLevel: 'medium',
          description: '',
          tags: [],
          modelCapabilities: {
            reasoningSupported: false,
            contextWindow: 1234,
          },
        },
      },
    ], []);

    expect(config?.modelCapabilities?.reasoningSupported).toBe(false);
    expect(config?.modelCapabilities?.contextWindow).toBe(1234);
  });
});
```

Extend `src/utils/default-nodes.test.ts`:

```ts
it('seeds empty agent capability overrides', () => {
  const node = getDefaultNodeData('agent');
  expect(node.type).toBe('agent');
  expect(node.modelCapabilities).toEqual({});
});
```

- [ ] **Step 2: Run the tests to verify the new fields are missing**

Run: `npm run test:run -- src/utils/default-nodes.test.ts src/utils/graph-to-agent.test.ts`

Expected: FAIL with TypeScript/runtime errors because `modelCapabilities` does not exist yet.

- [ ] **Step 3: Add shared types and wire them through the graph config path**

Create `src/types/model-metadata.ts`:

```ts
export type ModelInputModality = 'text' | 'image';

export interface ModelCostInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCapabilityOverrides {
  reasoningSupported?: boolean;
  inputModalities?: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCostInfo;
}

export interface DiscoveredModelMetadata {
  id: string;
  provider: string;
  reasoningSupported?: boolean;
  inputModalities?: ModelInputModality[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: ModelCostInfo;
}
```

Update `src/types/nodes.ts`:

```ts
import type { ModelCapabilityOverrides } from './model-metadata';

export interface AgentNodeData {
  // existing fields...
  modelCapabilities: ModelCapabilityOverrides;
}
```

Update `src/runtime/agent-config.ts`:

```ts
import type { ModelCapabilityOverrides } from '../types/model-metadata';

export interface AgentConfig {
  // existing fields...
  modelCapabilities: ModelCapabilityOverrides;
}
```

Update `src/utils/default-nodes.ts`:

```ts
case 'agent':
  return {
    type: 'agent',
    // existing defaults...
    modelCapabilities: {},
  };
```

Update `src/utils/graph-to-agent.ts`:

```ts
return {
  id: agentNodeId,
  // existing fields...
  modelCapabilities: data.modelCapabilities ?? {},
};
```

- [ ] **Step 4: Run the tests to verify the graph plumbing passes**

Run: `npm run test:run -- src/utils/default-nodes.test.ts src/utils/graph-to-agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types/model-metadata.ts src/types/nodes.ts src/runtime/agent-config.ts src/utils/default-nodes.ts src/utils/graph-to-agent.ts src/utils/default-nodes.test.ts src/utils/graph-to-agent.test.ts
git commit -m "feat: add agent model capability overrides"
```

## Task 3: Build the OpenRouter Model Catalog Store

**Files:**
- Create: `src/runtime/provider-model-options.ts`
- Create: `src/store/model-catalog-store.ts`
- Create: `src/store/model-catalog-store.test.ts`

- [ ] **Step 1: Write the failing store tests for discovery and key-sync behavior**

Create `src/store/model-catalog-store.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelCatalogStore } from './model-catalog-store';

describe('model catalog store', () => {
  beforeEach(() => {
    useModelCatalogStore.getState().reset();
  });

  it('fetches OpenRouter models when a new key is provided', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'xiaomi/mimo-v2-pro',
            context_length: 128000,
            pricing: { prompt: '0.1', completion: '0.2' },
            architecture: { input_modalities: ['text'] },
            top_provider: { max_completion_tokens: 8192 },
            supported_parameters: ['reasoning'],
          },
        ],
      }),
    })) as typeof fetch);

    await useModelCatalogStore.getState().syncOpenRouterKey('key-1');

    expect(useModelCatalogStore.getState().models.openrouter['xiaomi/mimo-v2-pro']).toBeDefined();
  });

  it('clears stale OpenRouter metadata before refetching when the key changes', async () => {
    useModelCatalogStore.setState({
      models: {
        openrouter: {
          stale: { id: 'stale', provider: 'openrouter' },
        },
      },
    } as any);

    const store = useModelCatalogStore.getState();
    await store.syncOpenRouterKey('key-2');

    expect(store.lastSyncedKeys.openrouter).toBe('key-2');
    expect(store.models.openrouter.stale).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the store tests to verify the discovery store does not exist yet**

Run: `npm run test:run -- src/store/model-catalog-store.test.ts`

Expected: FAIL because `useModelCatalogStore` and related types are missing.

- [ ] **Step 3: Implement the catalog store and OpenRouter metadata mapping**

Create `src/runtime/provider-model-options.ts`:

```ts
export const PROVIDERS = ['anthropic', 'openai', 'openrouter', 'google', 'ollama', 'mistral', 'groq', 'xai'] as const;

export const STATIC_MODELS: Record<string, string[]> = {
  anthropic: ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'],
  openrouter: [
    'anthropic/claude-sonnet-4-20250514',
    'anthropic/claude-haiku-4-5-20251001',
    'openai/gpt-4o',
    'openai/o3-mini',
    'google/gemini-2.0-flash',
    'meta-llama/llama-3.1-70b-instruct',
    'mistralai/mistral-large',
    'deepseek/deepseek-chat-v3',
  ],
  // remaining providers...
};
```

Create `src/store/model-catalog-store.ts`:

```ts
import { create } from 'zustand';
import type { DiscoveredModelMetadata } from '../types/model-metadata';

type ProviderModelMap = Record<string, DiscoveredModelMetadata>;

interface ModelCatalogState {
  models: { openrouter: ProviderModelMap };
  loading: { openrouter: boolean };
  errors: { openrouter: string | null };
  lastSyncedKeys: { openrouter?: string };
  syncOpenRouterKey: (apiKey: string | undefined) => Promise<void>;
  getProviderModels: (provider: string) => string[];
  getModelMetadata: (provider: string, modelId: string) => DiscoveredModelMetadata | undefined;
  reset: () => void;
}

function mapOpenRouterModel(entry: any): DiscoveredModelMetadata {
  return {
    id: entry.id,
    provider: 'openrouter',
    reasoningSupported: Array.isArray(entry.supported_parameters) && entry.supported_parameters.includes('reasoning'),
    inputModalities: entry.architecture?.input_modalities ?? ['text'],
    contextWindow: entry.context_length,
    maxTokens: entry.top_provider?.max_completion_tokens,
    cost: {
      input: Number(entry.pricing?.prompt ?? 0),
      output: Number(entry.pricing?.completion ?? 0),
      cacheRead: Number(entry.pricing?.cache_read ?? 0),
      cacheWrite: Number(entry.pricing?.cache_write ?? 0),
    },
  };
}
```

Key behavior to implement:

- `syncOpenRouterKey(undefined)` should clear loading and skip fetch.
- a new or changed key should clear existing OpenRouter cache, fetch fresh data, and store mapped metadata.
- unchanged key should no-op.
- `getProviderModels('openrouter')` should return discovered model IDs.

- [ ] **Step 4: Run the store tests to verify discovery behavior passes**

Run: `npm run test:run -- src/store/model-catalog-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/provider-model-options.ts src/store/model-catalog-store.ts src/store/model-catalog-store.test.ts
git commit -m "feat: add openrouter model discovery store"
```

## Task 4: Implement Runtime Model Resolution

**Files:**
- Create: `src/runtime/model-resolver.ts`
- Create: `src/runtime/model-resolver.test.ts`
- Modify: `src/runtime/agent-runtime.ts`

- [ ] **Step 1: Write the failing runtime resolution tests**

Create `src/runtime/model-resolver.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveRuntimeModel } from './model-resolver';

describe('resolveRuntimeModel', () => {
  it('returns the built-in pi-ai model when the model id is known', () => {
    const model = resolveRuntimeModel({
      provider: 'openai',
      modelId: 'gpt-4o',
      modelCapabilities: {},
      getDiscoveredModel: () => undefined,
    });

    expect(model.id).toBe('gpt-4o');
    expect(model.provider).toBe('openai');
  });

  it('builds a runtime model from discovered metadata when the model id is unknown to pi-ai', () => {
    const model = resolveRuntimeModel({
      provider: 'openrouter',
      modelId: 'xiaomi/mimo-v2-pro',
      modelCapabilities: { contextWindow: 64000 },
      getDiscoveredModel: () => ({
        id: 'xiaomi/mimo-v2-pro',
        provider: 'openrouter',
        reasoningSupported: true,
        inputModalities: ['text'],
        contextWindow: 128000,
        maxTokens: 8192,
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      }),
    });

    expect(model.id).toBe('xiaomi/mimo-v2-pro');
    expect(model.contextWindow).toBe(64000);
    expect(model.baseUrl).toContain('openrouter.ai');
  });

  it('falls back to a provider template when no discovered metadata exists', () => {
    const model = resolveRuntimeModel({
      provider: 'openrouter',
      modelId: 'manual/custom-model',
      modelCapabilities: {},
      getDiscoveredModel: () => undefined,
    });

    expect(model.id).toBe('manual/custom-model');
    expect(model.provider).toBe('openrouter');
  });
});
```

- [ ] **Step 2: Run the tests to verify runtime resolution is missing**

Run: `npm run test:run -- src/runtime/model-resolver.test.ts`

Expected: FAIL because `resolveRuntimeModel` does not exist yet.

- [ ] **Step 3: Implement the dedicated model resolver and swap the runtime over**

Create `src/runtime/model-resolver.ts`:

```ts
import { getModel, getModels } from '@mariozechner/pi-ai';
import type { Model } from '@mariozechner/pi-ai';
import type { Api } from '@mariozechner/pi-ai';
import type { DiscoveredModelMetadata, ModelCapabilityOverrides } from '../types/model-metadata';

interface ResolveRuntimeModelArgs {
  provider: string;
  modelId: string;
  modelCapabilities: ModelCapabilityOverrides;
  getDiscoveredModel: (provider: string, modelId: string) => DiscoveredModelMetadata | undefined;
}

export function resolveRuntimeModel(args: ResolveRuntimeModelArgs): Model<Api> {
  const builtIn = (getModel as (p: string, m: string) => Model<Api> | undefined)(args.provider, args.modelId);
  if (builtIn) {
    return applyCapabilityOverrides(builtIn, args.modelCapabilities);
  }

  const discovered = args.getDiscoveredModel(args.provider, args.modelId);
  const template = (getModels as (p: string) => Model<Api>[])(args.provider)[0];

  if (!template) {
    throw new Error(`No model template available for provider: ${args.provider}`);
  }

  return applyCapabilityOverrides({
    ...template,
    id: args.modelId,
    name: args.modelId,
    reasoning: discovered?.reasoningSupported ?? false,
    input: discovered?.inputModalities ?? template.input,
    contextWindow: discovered?.contextWindow ?? template.contextWindow,
    maxTokens: discovered?.maxTokens ?? template.maxTokens,
    cost: discovered?.cost ?? template.cost,
  }, args.modelCapabilities);
}
```

Update `src/runtime/agent-runtime.ts`:

```ts
import { resolveRuntimeModel } from './model-resolver';
import { useModelCatalogStore } from '../store/model-catalog-store';

const model = resolveRuntimeModel({
  provider: config.provider,
  modelId: config.modelId,
  modelCapabilities: config.modelCapabilities,
  getDiscoveredModel: (provider, modelId) =>
    useModelCatalogStore.getState().getModelMetadata(provider, modelId),
});
```

- [ ] **Step 4: Run the resolver tests to verify built-in, discovered, and fallback paths all pass**

Run: `npm run test:run -- src/runtime/model-resolver.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/model-resolver.ts src/runtime/model-resolver.test.ts src/runtime/agent-runtime.ts
git commit -m "feat: add runtime model resolver"
```

## Task 5: Sync OpenRouter Discovery From Saved API Keys

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/settings/settings-store.ts`
- Modify: `src/store/model-catalog-store.test.ts`

- [ ] **Step 1: Write the failing test that covers repeated key sync behavior**

Extend `src/store/model-catalog-store.test.ts`:

```ts
it('does not refetch when the OpenRouter key is unchanged', async () => {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: [] }),
  })) as typeof fetch;

  vi.stubGlobal('fetch', fetchMock);

  const store = useModelCatalogStore.getState();
  await store.syncOpenRouterKey('same-key');
  await store.syncOpenRouterKey('same-key');

  expect(fetchMock).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the store tests to verify the no-op key path is not implemented yet**

Run: `npm run test:run -- src/store/model-catalog-store.test.ts`

Expected: FAIL because unchanged-key behavior is missing or incorrect.

- [ ] **Step 3: Implement startup and API-key-change syncing**

Update `src/App.tsx`:

```ts
import { useEffect, useState } from 'react';
import { useSettingsStore } from './settings/settings-store';
import { useModelCatalogStore } from './store/model-catalog-store';

const openRouterKey = useSettingsStore((s) => s.apiKeys.openrouter);
const syncOpenRouterKey = useModelCatalogStore((s) => s.syncOpenRouterKey);

useEffect(() => {
  void syncOpenRouterKey(openRouterKey);
}, [openRouterKey, syncOpenRouterKey]);
```

Adjust `src/settings/settings-store.ts` only if needed to keep selector-friendly access stable, for example by preserving the `apiKeys` object shape and not mutating in place.

Update `syncOpenRouterKey(...)` to:

- return early when the key is unchanged
- clear cached models before refetch on key change
- skip fetch when the key is missing

- [ ] **Step 4: Run the store tests to verify startup/change sync behavior passes**

Run: `npm run test:run -- src/store/model-catalog-store.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/settings/settings-store.ts src/store/model-catalog-store.test.ts src/store/model-catalog-store.ts
git commit -m "feat: sync openrouter discovery from api keys"
```

## Task 6: Update the Agent Properties UI for Built-In, Discovered, and Custom Models

**Files:**
- Modify: `src/panels/property-editors/AgentProperties.tsx`
- Create: `src/panels/property-editors/AgentProperties.test.tsx`
- Modify: `src/runtime/provider-model-options.ts`

- [ ] **Step 1: Write the failing UI tests for model selection and override editing**

Create `src/panels/property-editors/AgentProperties.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import AgentProperties from './AgentProperties';
import { useGraphStore } from '../../store/graph-store';
import { useModelCatalogStore } from '../../store/model-catalog-store';

describe('AgentProperties', () => {
  beforeEach(() => {
    useModelCatalogStore.setState({
      models: {
        openrouter: {
          'xiaomi/mimo-v2-pro': {
            id: 'xiaomi/mimo-v2-pro',
            provider: 'openrouter',
            inputModalities: ['text'],
            contextWindow: 128000,
            maxTokens: 8192,
            reasoningSupported: true,
            cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
          },
        },
      },
    } as any);
  });

  it('shows a custom model input when the selected model is not in the list', () => {
    render(<AgentProperties nodeId="agent-1" data={{
      type: 'agent',
      name: 'Agent',
      systemPrompt: 'Test',
      provider: 'openrouter',
      modelId: 'manual/custom-model',
      thinkingLevel: 'off',
      description: '',
      tags: [],
      modelCapabilities: {},
    }} />);

    expect(screen.getByDisplayValue('manual/custom-model')).toBeInTheDocument();
  });

  it('resets to the first built-in model when the provider changes', () => {
    render(/* same component with openrouter */);

    fireEvent.change(screen.getByLabelText('Provider'), {
      target: { value: 'anthropic' },
    });

    const node = useGraphStore.getState().nodes.find((n) => n.id === 'agent-1');
    expect(node?.data.modelId).toBe('claude-opus-4-20250514');
  });
});
```

- [ ] **Step 2: Run the UI tests to verify the current editor only supports static select values**

Run: `npm run test:run -- src/panels/property-editors/AgentProperties.test.tsx`

Expected: FAIL because discovered models, custom mode, and capability override controls do not exist yet.

- [ ] **Step 3: Implement the Agent editor changes**

Refactor `src/panels/property-editors/AgentProperties.tsx` to:

```tsx
import { useMemo } from 'react';
import { useModelCatalogStore } from '../../store/model-catalog-store';
import { PROVIDERS, STATIC_MODELS } from '../../runtime/provider-model-options';

const CUSTOM_MODEL_VALUE = '__custom__';

function getModelOptions(provider: string, discovered: string[]) {
  const merged = new Set([...(STATIC_MODELS[provider] ?? []), ...discovered]);
  return [...merged];
}
```

Key UI behavior to implement:

- derive `availableModels` from static + discovered models
- derive `isCustomModel` from whether `data.modelId` is in `availableModels`
- append `Custom model...` to the select
- show a text input when custom mode is active
- show per-agent capability fields using:
  - resolved discovered/default value
  - stored override value when present
  - explicit reset behavior that deletes only the overridden field

Suggested override write pattern:

```ts
update(nodeId, {
  modelCapabilities: {
    ...data.modelCapabilities,
    contextWindow: Number(e.target.value),
  },
});
```

Suggested reset pattern:

```ts
const { contextWindow, ...rest } = data.modelCapabilities;
update(nodeId, { modelCapabilities: rest });
```

- [ ] **Step 4: Run the UI tests to verify discovered/custom model selection and overrides work**

Run: `npm run test:run -- src/panels/property-editors/AgentProperties.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/panels/property-editors/AgentProperties.tsx src/panels/property-editors/AgentProperties.test.tsx src/runtime/provider-model-options.ts
git commit -m "feat: add discovered and custom agent model selection"
```

## Task 7: Full Verification and Cleanup

**Files:**
- Modify: any files touched during earlier tasks if small cleanup is needed

- [ ] **Step 1: Run the focused test suite**

Run:

```bash
npm run test:run -- src/utils/default-nodes.test.ts src/utils/graph-to-agent.test.ts src/store/model-catalog-store.test.ts src/runtime/model-resolver.test.ts src/panels/property-editors/AgentProperties.test.tsx
```

Expected: PASS with all targeted tests green.

- [ ] **Step 2: Run the full build**

Run: `npm run build`

Expected: PASS with TypeScript compile and Vite build succeeding.

- [ ] **Step 3: Perform manual verification in the browser**

Manual checklist:

- Launch the app with `npm run dev`
- Add an OpenRouter API key in Settings
- Confirm discovered OpenRouter models appear in the Agent `Model` select
- Select `Custom model...` and enter `xiaomi/mimo-v2-pro`
- Confirm capability fields show discovered/default values and can be overridden
- Change provider and confirm the model resets to the first built-in model
- Open chat and confirm runtime creation does not crash for:
  - built-in OpenRouter model
  - discovered OpenRouter model
  - manual custom OpenRouter model

- [ ] **Step 4: Update docs only if implementation diverged from the spec**

If implementation details changed materially, update:

- `docs/superpowers/specs/2026-04-01-agent-custom-model-discovery-design.md`

Otherwise skip this step.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat: support discovered and custom agent models"
```

## Notes For Execution

- Keep runtime model resolution in `src/runtime/model-resolver.ts`; do not let `AgentProperties.tsx` synthesize runtime `Model` objects.
- Keep provider-discovered metadata out of Agent node data. Agent nodes should store user-authored intent, not shared provider cache entries.
- Preserve the current `thinkingLevel` control. `reasoningSupported` is a capability constraint, not a replacement for `thinkingLevel`.
- Do not expand scope into custom provider support during this plan. Track that work separately under the existing TODO from the spec.
