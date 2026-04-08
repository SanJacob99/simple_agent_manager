# OpenRouter Model Cache And Default Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move OpenRouter model discovery behind a backend-persisted cache file and reuse a searchable model picker in both the canvas Agent editor and Settings Defaults, while preserving manual custom model IDs.

**Architecture:** Add a server-owned OpenRouter catalog store that handles file persistence, upstream fetches, and key-fingerprint safety, then expose it through lightweight Express routes. Refactor the frontend catalog Zustand store to load, refresh, and clear that cached data through backend endpoints, and extract the shared model-picker UI/utility logic so AgentProperties and DefaultsSection can share the same search/custom-model behavior without sharing parent-specific side effects.

**Tech Stack:** TypeScript, React 19, Zustand, Express, Vitest, Testing Library, Node `fs/promises`, Node `crypto`

**Spec:** `docs/superpowers/specs/2026-04-08-openrouter-model-cache-and-default-picker-design.md`

---

## Assumptions And Important Considerations

- Assume the backend remains available whenever Settings is in use.
- Keep the cache in a dedicated file instead of `settings.json` so normal settings writes stay small and low-risk.
- Preserve manual custom model ID entry even when the catalog is stale, missing, or the OpenRouter account changed.
- Treat `src/settings/sections/DefaultsSection.tsx` as a dirty file in the current workspace; integrate local edits instead of overwriting them.

## File Structure

### New files
| File | Responsibility |
|------|----------------|
| `shared/model-catalog.ts` | Shared response types for cached OpenRouter catalog payloads |
| `server/runtime/openrouter-model-catalog-store.ts` | Owns cache file load/save/refresh/clear behavior and key mismatch masking |
| `server/runtime/openrouter-model-catalog-store.test.ts` | Verifies cache persistence, refresh, and key mismatch behavior |
| `src/components/model-picker/provider-model-utils.ts` | Shared provider-model option, search, and default-selection helpers |
| `src/components/model-picker/provider-model-utils.test.ts` | Verifies dedupe, search, and OpenRouter default-selection rules |
| `src/components/model-picker/ProviderModelPicker.tsx` | Shared searchable picker UI used by AgentProperties and DefaultsSection |
| `src/settings/sections/ModelCatalogSection.test.tsx` | Verifies cached catalog UI and manual refresh behavior |

### Modified files
| File | Change |
|------|--------|
| `server/index.ts` | Add cached load, refresh, and clear routes for OpenRouter catalog |
| `src/store/model-catalog-store.ts` | Replace direct OpenRouter fetches with backend-backed load/refresh/clear actions |
| `src/store/model-catalog-store.test.ts` | Update store tests to cover backend cache API contract |
| `src/App.tsx` | Load cached catalog after settings are loaded instead of auto-refreshing OpenRouter |
| `src/App.test.tsx` | Verify startup uses cached load action |
| `src/panels/property-editors/AgentProperties.tsx` | Replace inline picker logic with shared picker/utilities |
| `src/panels/property-editors/AgentProperties.test.tsx` | Keep canvas picker regressions covered after extraction |
| `src/settings/sections/DefaultsSection.tsx` | Replace static model select with shared searchable picker |
| `src/settings/sections/DefaultsSection.test.tsx` | Verify search, discovered model use, and manual custom model entry |
| `src/settings/sections/ModelCatalogSection.tsx` | Use refresh action, show cached sync state, and explain refresh-required user models |
| `src/settings/sections/DataMaintenanceSection.tsx` | Clear persisted catalog file during settings reset flows |
| `src/settings/sections/DataMaintenanceSection.test.tsx` | Verify reset flows clear persisted catalog state |
| `src/settings/types.ts` | Update Model Catalog section description text if needed |
| `src/settings/SettingsWorkspace.test.tsx` | Update section-description assertion if text changes |
| `docs/concepts/agent-node.md` | Document cached discovery/manual model picker behavior and update last-verified date |

---

### Task 1: Add Shared Cache Contract And Backend Catalog Store

**Files:**
- Create: `shared/model-catalog.ts`
- Create: `server/runtime/openrouter-model-catalog-store.ts`
- Test: `server/runtime/openrouter-model-catalog-store.test.ts`

- [ ] **Step 1: Write the failing backend catalog-store tests**

Create `server/runtime/openrouter-model-catalog-store.test.ts` with coverage for:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { OpenRouterModelCatalogStore } from './openrouter-model-catalog-store';

describe('OpenRouterModelCatalogStore', () => {
  it('returns empty cached data when no file exists and no key is provided', async () => {});
  it('refreshes from OpenRouter and persists the cache file', async () => {});
  it('keeps full models but masks userModels when the current key changed', async () => {});
  it('does not overwrite a healthy cache file when refresh fails', async () => {});
});
```

- [ ] **Step 2: Run the tests to confirm the new module is missing**

Run: `npx vitest run server/runtime/openrouter-model-catalog-store.test.ts`
Expected: FAIL with module-not-found/type errors for the new store and shared types.

- [ ] **Step 3: Add the shared cache response types**

Create `shared/model-catalog.ts`:

```ts
import type { DiscoveredModelMetadata } from './agent-config';

export type ProviderModelMap = Record<string, DiscoveredModelMetadata>;

export interface OpenRouterCatalogResponse {
  models: ProviderModelMap;
  userModels: ProviderModelMap;
  syncedAt: string | null;
  userModelsRequireRefresh: boolean;
}
```

- [ ] **Step 4: Implement the backend catalog store**

Create `server/runtime/openrouter-model-catalog-store.ts` with:

```ts
interface PersistedOpenRouterCatalog {
  models: ProviderModelMap;
  userModels: ProviderModelMap;
  syncedAt: string | null;
  userModelsKeyFingerprint: string | null;
}

export class OpenRouterModelCatalogStore {
  constructor(
    private readonly dir = process.cwd(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async loadForClient(apiKey?: string): Promise<OpenRouterCatalogResponse> {}
  async refresh(apiKey: string): Promise<OpenRouterCatalogResponse> {}
  async clear(): Promise<void> {}
  getFilePath(): string {}
}
```

Implementation requirements:
- Persist to a dedicated file such as `openrouter-model-catalog.json`
- Fetch both `https://openrouter.ai/api/v1/models` and `https://openrouter.ai/api/v1/models/user`
- Reuse the existing metadata mapping from `src/store/model-catalog-store.ts`
- Hash the OpenRouter key with `crypto.createHash('sha256')`
- On key mismatch, return cached `models`, return `{}` for `userModels`, and set `userModelsRequireRefresh: true`
- On refresh failure, leave an existing cache file untouched

- [ ] **Step 5: Run the backend catalog-store tests**

Run: `npx vitest run server/runtime/openrouter-model-catalog-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add shared/model-catalog.ts server/runtime/openrouter-model-catalog-store.ts server/runtime/openrouter-model-catalog-store.test.ts
git commit -m "feat: add persisted OpenRouter catalog store"
```

---

### Task 2: Wire Backend Routes And Refactor The Frontend Catalog Store

**Files:**
- Modify: `server/index.ts`
- Modify: `src/store/model-catalog-store.ts`
- Test: `src/store/model-catalog-store.test.ts`

- [ ] **Step 1: Rewrite the frontend catalog-store tests for the backend cache contract**

Update `src/store/model-catalog-store.test.ts` to cover:

```ts
it('loads cached OpenRouter catalog data from the backend', async () => {});
it('refreshes the OpenRouter catalog through the backend refresh endpoint', async () => {});
it('clears persisted catalog state through the backend delete endpoint', async () => {});
it('keeps full models visible when userModelsRequireRefresh is true', async () => {});
```

- [ ] **Step 2: Run the catalog-store tests and confirm they fail**

Run: `npx vitest run src/store/model-catalog-store.test.ts`
Expected: FAIL because the store still exposes `syncOpenRouterKey(...)` and still calls OpenRouter directly.

- [ ] **Step 3: Add backend routes in `server/index.ts`**

Instantiate the new store near `SettingsFileStore`:

```ts
const modelCatalogStore = new OpenRouterModelCatalogStore();
```

Add routes:

```ts
app.get('/api/model-catalog/openrouter', async (_req, res) => {
  const apiKey = apiKeys.get('openrouter');
  res.json(await modelCatalogStore.loadForClient(apiKey));
});

app.post('/api/model-catalog/openrouter/refresh', async (_req, res) => {
  const apiKey = apiKeys.get('openrouter');
  if (!apiKey) return res.status(400).json({ error: 'OpenRouter API key is required' });
  res.json(await modelCatalogStore.refresh(apiKey));
});

app.delete('/api/model-catalog/openrouter', async (_req, res) => {
  await modelCatalogStore.clear();
  res.json({ ok: true });
});
```

- [ ] **Step 4: Replace the frontend store actions**

Refactor `src/store/model-catalog-store.ts` so the public API becomes:

```ts
interface ModelCatalogState {
  models: { openrouter: ProviderModelMap };
  userModels: { openrouter: ProviderModelMap };
  syncedAt: { openrouter: string | null };
  userModelsRequireRefresh: { openrouter: boolean };
  loading: { openrouter: boolean };
  errors: { openrouter: string | null };
  loadOpenRouterCatalog: () => Promise<void>;
  refreshOpenRouterCatalog: (apiKey?: string) => Promise<void>;
  clearOpenRouterCatalog: () => Promise<void>;
  getProviderModels: (provider: string) => string[];
  getModelMetadata: (provider: string, modelId: string) => DiscoveredModelMetadata | undefined;
  reset: () => void;
}
```

Implementation requirements:
- `loadOpenRouterCatalog()` uses `GET /api/model-catalog/openrouter`
- `refreshOpenRouterCatalog()` uses `POST /api/model-catalog/openrouter/refresh`
- `clearOpenRouterCatalog()` uses `DELETE /api/model-catalog/openrouter`
- Remove `lastSyncedKeys`
- Keep `reset()` as local in-memory reset only

- [ ] **Step 5: Run the frontend catalog-store tests**

Run: `npx vitest run src/store/model-catalog-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/index.ts src/store/model-catalog-store.ts src/store/model-catalog-store.test.ts
git commit -m "feat: route model catalog through backend cache endpoints"
```

---

### Task 3: Load Cached Catalog On Startup And Clear It During Reset Flows

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/settings/sections/DataMaintenanceSection.tsx`
- Modify: `src/settings/sections/DataMaintenanceSection.test.tsx`

- [ ] **Step 1: Add failing tests for startup load and reset cleanup**

Extend `src/App.test.tsx` with:

```ts
it('loads the cached OpenRouter catalog after settings load completes', async () => {});
```

Extend `src/settings/sections/DataMaintenanceSection.test.tsx` with:

```ts
it('clears the persisted model catalog during app settings reset', async () => {});
it('clears the persisted model catalog during reset everything', async () => {});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/App.test.tsx src/settings/sections/DataMaintenanceSection.test.tsx`
Expected: FAIL because `loadOpenRouterCatalog` and `clearOpenRouterCatalog` are not wired into those flows yet.

- [ ] **Step 3: Update startup and reset flows**

In `src/App.tsx`, replace the current OpenRouter sync effect with a cached load effect:

```ts
const loadOpenRouterCatalog = useModelCatalogStore((s) => s.loadOpenRouterCatalog);

useEffect(() => {
  if (!settingsLoaded) return;
  void loadOpenRouterCatalog();
}, [settingsLoaded, openRouterKey, loadOpenRouterCatalog]);
```

In `src/settings/sections/DataMaintenanceSection.tsx`, replace the local reset-only catalog call with the persisted clear action:

```ts
const clearOpenRouterCatalog = useModelCatalogStore((state) => state.clearOpenRouterCatalog);
```

Use it in both:
- `Clear App Settings`
- `Reset Everything`

- [ ] **Step 4: Run the startup/reset tests**

Run: `npx vitest run src/App.test.tsx src/settings/sections/DataMaintenanceSection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/settings/sections/DataMaintenanceSection.tsx src/settings/sections/DataMaintenanceSection.test.tsx
git commit -m "feat: load cached catalog on startup and clear it on reset"
```

---

### Task 4: Extract Shared Picker Utilities And Migrate AgentProperties

**Files:**
- Create: `src/components/model-picker/provider-model-utils.ts`
- Create: `src/components/model-picker/provider-model-utils.test.ts`
- Create: `src/components/model-picker/ProviderModelPicker.tsx`
- Modify: `src/panels/property-editors/AgentProperties.tsx`
- Test: `src/panels/property-editors/AgentProperties.test.tsx`

- [ ] **Step 1: Write the failing shared utility tests**

Create `src/components/model-picker/provider-model-utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getDefaultModelId, getModelOptions, isCustomModelId } from './provider-model-utils';

describe('provider-model-utils', () => {
  it('deduplicates static and discovered model IDs', () => {});
  it('prefers the first tool-capable discovered OpenRouter model as the default', () => {});
  it('identifies when a modelId is custom for the current provider list', () => {});
});
```

- [ ] **Step 2: Run the utility tests and confirm they fail**

Run: `npx vitest run src/components/model-picker/provider-model-utils.test.ts`
Expected: FAIL with module-not-found errors.

- [ ] **Step 3: Implement the shared utilities and picker component**

Add `src/components/model-picker/provider-model-utils.ts` with helpers extracted from `AgentProperties.tsx`:

```ts
export function getModelOptions(provider: string, staticModels: string[], discoveredModels: string[]): string[] {}
export function getDefaultModelId(provider: string, discoveredModels: string[], openRouterModels: Record<string, DiscoveredModelMetadata>): string {}
export function getCustomModelPlaceholder(provider: string): string {}
export function isCustomModelId(modelId: string, availableModels: string[]): boolean {}
```

Create `src/components/model-picker/ProviderModelPicker.tsx` as a reusable UI component that accepts:

```tsx
interface ProviderModelPickerProps {
  provider: string;
  modelId: string;
  availableModels: string[];
  discoveredModels?: Record<string, DiscoveredModelMetadata>;
  onSelectModel: (modelId: string) => void;
  onChangeManualModelId: (modelId: string) => void;
  enableOpenRouterFilters?: boolean;
}
```

Keep these parent-specific behaviors outside the shared component:
- `AgentProperties` capability snapshot writes
- `DefaultsSection` `setAgentDefaults(...)` updates

- [ ] **Step 4: Migrate `AgentProperties.tsx`**

Replace the inline picker state/rendering in `src/panels/property-editors/AgentProperties.tsx` with the shared utility/component layer, but preserve:
- capability snapshotting on model selection
- OpenRouter filter chips
- custom manual model entry

- [ ] **Step 5: Run shared utility and AgentProperties tests**

Run: `npx vitest run src/components/model-picker/provider-model-utils.test.ts src/panels/property-editors/AgentProperties.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/model-picker/provider-model-utils.ts src/components/model-picker/provider-model-utils.test.ts src/components/model-picker/ProviderModelPicker.tsx src/panels/property-editors/AgentProperties.tsx src/panels/property-editors/AgentProperties.test.tsx
git commit -m "refactor: share provider model picker logic"
```

---

### Task 5: Migrate DefaultsSection And Refresh The Catalog UI

**Files:**
- Modify: `src/settings/sections/DefaultsSection.tsx`
- Modify: `src/settings/sections/DefaultsSection.test.tsx`
- Modify: `src/settings/sections/ModelCatalogSection.tsx`
- Create: `src/settings/sections/ModelCatalogSection.test.tsx`
- Modify: `src/settings/types.ts`
- Modify: `src/settings/SettingsWorkspace.test.tsx`

- [ ] **Step 1: Add failing Defaults and Model Catalog UI tests**

Extend `src/settings/sections/DefaultsSection.test.tsx` with:

```ts
it('shows a searchable picker for default agent models', () => {});
it('allows a manual custom OpenRouter model ID in defaults', () => {});
it('shows discovered OpenRouter models in the default picker', () => {});
```

Create `src/settings/sections/ModelCatalogSection.test.tsx` with:

```ts
it('calls refreshOpenRouterCatalog when Sync Models is clicked', async () => {});
it('shows cached sync metadata when a catalog exists', () => {});
it('shows a refresh-required hint when userModelsRequireRefresh is true', () => {});
```

- [ ] **Step 2: Run the Defaults and Model Catalog tests**

Run: `npx vitest run src/settings/sections/DefaultsSection.test.tsx src/settings/sections/ModelCatalogSection.test.tsx`
Expected: FAIL because Defaults still renders a static `<select>` and ModelCatalogSection still uses the old store action/state.

- [ ] **Step 3: Replace the default-agent model select with the shared picker**

In `src/settings/sections/DefaultsSection.tsx`:
- keep the existing provider `<select>`
- replace the `Model` `<select>` with `ProviderModelPicker`
- derive the default-model reset with `getDefaultModelId(...)`
- call `setAgentDefaults({ modelId })` on selection/manual edits

Important consideration:
- integrate the existing local edits in `DefaultsSection.tsx`; do not replace the whole file if the user already changed nearby lines

- [ ] **Step 4: Update the catalog screen to reflect cached state**

In `src/settings/sections/ModelCatalogSection.tsx`:
- replace `syncOpenRouterKey` with `refreshOpenRouterCatalog`
- read `syncedAt` and `userModelsRequireRefresh`
- change the section copy to make it clear the screen shows cached discovery data plus manual refresh

Recommended text:

```tsx
{syncedAt
  ? `Cached OpenRouter catalog last updated ${new Date(syncedAt).toLocaleString()}.`
  : 'No models synchronized yet.'}
```

```tsx
{userModelsRequireRefresh && (
  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
    Your OpenRouter API key changed. Refresh to repopulate "My Enabled Models" for this account.
  </div>
)}
```

- [ ] **Step 5: Update settings metadata text if needed**

In `src/settings/types.ts`, update the section description to:

```ts
description: 'Inspect and refresh cached OpenRouter model discovery.',
```

Update `src/settings/SettingsWorkspace.test.tsx` to match.

- [ ] **Step 6: Run the Defaults and Model Catalog tests again**

Run: `npx vitest run src/settings/sections/DefaultsSection.test.tsx src/settings/sections/ModelCatalogSection.test.tsx src/settings/SettingsWorkspace.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/settings/sections/DefaultsSection.tsx src/settings/sections/DefaultsSection.test.tsx src/settings/sections/ModelCatalogSection.tsx src/settings/sections/ModelCatalogSection.test.tsx src/settings/types.ts src/settings/SettingsWorkspace.test.tsx
git commit -m "feat: add cached searchable model picker to settings"
```

---

### Task 6: Update Agent Documentation And Run Verification

**Files:**
- Modify: `docs/concepts/agent-node.md`

- [ ] **Step 1: Read the concept manifest**

Run: `Get-Content docs/concepts/_manifest.json`
Expected: confirm `agent` maps to `agent-node.md`.

- [ ] **Step 2: Update `docs/concepts/agent-node.md`**

Document:
- the shared searchable picker behavior
- manual custom model IDs in agent/default settings flows
- cached OpenRouter discovery as a frontend convenience, not a runtime dependency

Update:

```md
<!-- last-verified: 2026-04-08 -->
```

- [ ] **Step 3: Run targeted regression tests**

Run:

```bash
npx vitest run server/runtime/openrouter-model-catalog-store.test.ts src/store/model-catalog-store.test.ts src/App.test.tsx src/panels/property-editors/AgentProperties.test.tsx src/settings/sections/DefaultsSection.test.tsx src/settings/sections/ModelCatalogSection.test.tsx src/settings/sections/DataMaintenanceSection.test.tsx src/settings/SettingsWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Run the TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit the docs and any verification fixes**

```bash
git add docs/concepts/agent-node.md
git commit -m "docs: update agent node docs for cached model discovery"
```

