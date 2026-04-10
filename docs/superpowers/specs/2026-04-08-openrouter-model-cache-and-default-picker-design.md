# OpenRouter Model Cache And Default Picker Design

Date: 2026-04-08
Status: Draft approved in conversation, written for review

## Summary

Improve the default agent model picker in Settings so it matches the canvas Agent properties experience: searchable model selection, support for manual custom model IDs, and seamless use of discovered OpenRouter models.

At the same time, move OpenRouter model discovery behind a server-owned persisted cache file. On startup, the app should read that local cache first. It should only call the OpenRouter API automatically when no cache file exists, and otherwise refresh only when the user manually triggers a sync.

## Goals

- Let the Settings Defaults agent model field support provider models that are not in the hardcoded static list.
- Reuse the searchable model-picker experience from the canvas Agent properties panel.
- Keep manual custom model ID entry available even when discovery data is stale or missing.
- Reduce repeated large OpenRouter model fetches from the browser.
- Persist OpenRouter model discovery in a dedicated local file owned by the backend.
- Use the persisted cache on startup instead of refetching on every app load.
- Keep account-specific `userModels` safe when the OpenRouter API key changes.

## Non-Goals

- Do not add background TTL-based refresh in this change.
- Do not require a successful OpenRouter fetch before model selection works.
- Do not remove the static built-in provider model lists.
- Do not change runtime support for manual custom model IDs beyond what already exists.
- Do not store the heavy catalog payload inside `settings.json`.

## Current State

- The canvas Agent editor in `src/panels/property-editors/AgentProperties.tsx` already supports:
  - searchable model picking
  - filter chips for discovered OpenRouter models
  - manual custom model ID entry
- The Settings defaults editor in `src/settings/sections/DefaultsSection.tsx` still uses a basic static `<select>`.
- `src/store/model-catalog-store.ts` currently fetches OpenRouter data directly from the browser.
- `src/App.tsx` triggers `syncOpenRouterKey(...)` on startup whenever an OpenRouter key exists.
- `server/runtime/settings-file-store.ts` persists lightweight app settings to `settings.json`, but there is no dedicated persisted model-catalog cache file.

## Approved Product Behavior

### Settings Default Model Picker

- Replace the plain default-agent model `<select>` with a searchable picker that follows the same model-selection behavior as the canvas Agent properties editor.
- The picker should merge:
  - built-in static models
  - discovered OpenRouter models from the cached catalog, when available
- The picker should still allow a manual custom model ID input when the desired model is not listed.
- The UI should derive custom/manual mode from whether the current `modelId` exists in the available model list. It should not persist a separate `isCustomModel` flag.

### Provider Switch Behavior

- Changing the default provider should reset the default `modelId` to the first valid model for that provider.
- For OpenRouter, "first valid model" should continue to prefer an appropriate discovered model when that is part of the current picker logic; otherwise it falls back to the first static model.
- Switching providers exits any currently open manual custom-model editing state.

### Discovery Availability

- If OpenRouter discovery data is available, include it in the search results.
- If discovery data is unavailable, the picker must still work using static models plus manual custom model entry.
- Users must never be blocked from typing a valid provider-supported OpenRouter model ID just because the cache is stale or empty.

## Cache Strategy

### Source Of Truth

- OpenRouter model discovery should be owned by the backend, not fetched directly by the frontend store.
- Persist the catalog in a dedicated cache file, separate from `settings.json`.
- The cache file should include:
  - full `models`
  - account-specific `userModels`
  - `syncedAt`
  - a non-reversible fingerprint of the OpenRouter API key used when `userModels` were fetched

### Startup Behavior

- On app startup, the frontend should request the cached catalog from the backend.
- If the cache file exists, return it without calling OpenRouter.
- If the cache file does not exist and an OpenRouter API key is configured, the backend should fetch OpenRouter once, persist the result, and return it.
- If the cache file does not exist and there is no OpenRouter API key, return an empty catalog.

### Manual Refresh Behavior

- The Settings Model Catalog screen should expose the manual refresh control as the explicit sync action.
- Manual refresh should always fetch fresh OpenRouter data from the backend, overwrite the cache file, and update the client store.
- Normal app startup should not re-fetch from OpenRouter when a cache file already exists.

### API Key Change Behavior

- The OpenRouter `/models/user` response is account-specific, so cached `userModels` cannot be blindly reused across API key changes.
- When the current key does not match the cached key fingerprint:
  - cached full `models` may still be returned
  - cached `userModels` should be cleared or ignored until a manual refresh is performed
- This avoids showing enabled-model data for the wrong OpenRouter account.

## Backend Design

### New Persistence Store

Add a dedicated runtime store, likely alongside `server/runtime/settings-file-store.ts`, for example:

- `server/runtime/openrouter-model-catalog-store.ts`

Responsibilities:

- load persisted cache data from disk
- save refreshed cache data to disk
- clear the cache file when needed
- expose the resolved file path for diagnostics and tests

### New Backend Endpoints

Add backend routes in `server/index.ts`:

- `GET /api/model-catalog/openrouter`
  - returns cached data
  - fetches and persists only when the cache file is missing and an API key is available
- `POST /api/model-catalog/openrouter/refresh`
  - forces a fresh OpenRouter fetch
  - overwrites the cache file
- Optional: `DELETE /api/model-catalog/openrouter`
  - removes the persisted cache file
  - useful for reset flows and tests

### Server Fetch Ownership

- All OpenRouter network fetches for catalog discovery should move server-side.
- The frontend should stop calling `https://openrouter.ai/api/v1/models` and `.../models/user` directly.

Important consideration:

- keeping these fetches server-side reduces repeated large payload transfers to the browser and makes the cache reusable for future backend/runtime model metadata needs

## Frontend Design

### Shared Model Picker

Extract the shared model-picker behavior from `src/panels/property-editors/AgentProperties.tsx` into a reusable component or shared helper module.

The shared logic should handle:

- merged static + discovered provider models
- search filtering
- optional OpenRouter-specific filtering behavior
- custom model/manual mode detection
- model selection and reset behavior

The first consumer changes should be:

- `src/panels/property-editors/AgentProperties.tsx`
- `src/settings/sections/DefaultsSection.tsx`

### Model Catalog Store

Refactor `src/store/model-catalog-store.ts` so it no longer fetches OpenRouter directly from the browser.

Instead, it should:

- load cached catalog data from backend routes
- expose loading and error state
- expose a manual refresh action
- expose helper accessors for model IDs and metadata
- invalidate account-specific `userModels` when the key fingerprint no longer matches the current key

### App Startup

Replace the startup `syncOpenRouterKey(...)` behavior in `src/App.tsx` with a cached catalog load call.

Approved behavior:

- startup loads cached catalog state
- startup does not force a fresh OpenRouter sync when cache data already exists
- manual refresh remains the explicit way to update the persisted file

## File Responsibilities

Likely file changes:

- Modify `src/settings/sections/DefaultsSection.tsx`
  - replace static select with shared searchable model picker
- Modify `src/panels/property-editors/AgentProperties.tsx`
  - adopt shared picker logic instead of duplicating it
- Modify `src/store/model-catalog-store.ts`
  - switch from direct browser fetches to backend-backed cache loading/refresh
- Modify `src/settings/sections/ModelCatalogSection.tsx`
  - keep the manual sync button, but route it through backend refresh
- Modify `src/App.tsx`
  - load cached catalog on startup instead of auto-syncing fresh data
- Add `server/runtime/openrouter-model-catalog-store.ts`
  - dedicated persisted cache file management
- Modify `server/index.ts`
  - add catalog cache load/refresh endpoints

## Error Handling

- No OpenRouter key:
  - return empty discovery data
  - keep static models and manual custom input available
- Cache file missing:
  - fetch and persist only if a key exists
- OpenRouter refresh fails:
  - keep the previous cache file if one already exists
  - surface a non-blocking error in the UI
- Key changed without refresh:
  - reuse full cached `models`
  - suppress cached `userModels` until refreshed

Important consideration:

- preserving the previous cache on refresh failure is safer than overwriting the file with empty data, because it keeps search and metadata usable offline or during temporary provider issues

## Testing Strategy

### Frontend Tests

- Settings defaults model picker renders searchable results instead of only a static select.
- Settings defaults allow manual custom model entry for unknown OpenRouter model IDs.
- Changing provider resets the default model correctly.
- Model catalog store loads cached catalog data from the backend.
- Manual refresh updates the store from the backend refresh endpoint.
- Key mismatch suppresses cached `userModels` until refresh.

### Backend Tests

- Cache load returns persisted file contents when present.
- Cache load fetches and persists when the file is missing and an API key exists.
- Cache load returns empty data when no file and no API key exist.
- Refresh overwrites the cache file with the latest fetched data.
- Key fingerprint mismatch prevents stale `userModels` reuse.

### Regression Coverage

- Manual custom OpenRouter model IDs remain configurable when discovery data is empty or stale.
- Existing canvas Agent model-picker behavior continues to work after shared extraction.

## Risks

- Sharing picker logic across the canvas editor and Settings defaults can cause UI regressions if responsibilities are not clearly separated between stateful wrappers and shared rendering logic.
- Account-specific `userModels` behavior may become confusing if the UI does not explain why the full catalog is visible but the "enabled models" subset is empty after an API key change.
- A stale cache means newly added OpenRouter models will not appear until manual refresh.

## Assumptions

- The local backend is available whenever the Settings UI is being used.
- Users prefer manual freshness control over automatic repeated API syncs.
- A dedicated persisted catalog file is acceptable in addition to `settings.json`.
- Stale discovery data is acceptable because manual custom model entry remains available as an escape hatch.

## Important Considerations

- Using a dedicated cache file instead of `settings.json` keeps normal settings persistence smaller, clearer, and less fragile.
- Manual custom model entry is still required even after adding a persisted catalog, because OpenRouter can expose valid models that are not yet in the cached file.
- Server-side cache ownership creates a clean extension point if runtime or backend workflows need provider model metadata later.

## Implementation Outline

1. Add a dedicated server-side OpenRouter catalog cache store and persistence format.
2. Add backend routes for cached load and forced refresh.
3. Refactor the frontend model-catalog store to consume backend cache routes instead of calling OpenRouter directly.
4. Extract shared searchable model-picker behavior from the canvas Agent properties implementation.
5. Replace the Settings Defaults model field with the shared searchable picker and manual custom model flow.
6. Update app startup to load cached catalog data rather than force a fresh sync.
7. Update the Model Catalog screen to use backend refresh and to reflect cached-versus-refreshed state clearly.
8. Add regression tests for cache behavior and the Settings default model picker.

