# App Settings Workspace Design

Date: 2026-04-03
Status: Draft approved in conversation, written for review

## Summary

Replace the current settings modal with a dedicated app-level settings workspace inside the existing single-page app shell.

The app will support two top-level view modes:

- `canvas`
- `settings`

In `settings` mode, the main workspace becomes a full settings page with section navigation for:

- `Providers & API Keys`
- `Model Catalog`
- `Defaults`
- `Data & Maintenance`

This change keeps the current app architecture lightweight, gives app-level configuration enough room to grow, and establishes real defaults for newly created agents without turning settings into a full template-authoring system.

## Goals

- Replace the current modal with a dedicated settings workspace.
- Keep the app as a single-screen React app without introducing routing in this change.
- Move app-level actions out of the canvas sidebar and into Settings.
- Keep API key management as a first-class settings feature.
- Surface OpenRouter model catalog sync as an explicit settings concern.
- Add real app-level defaults for newly created agents:
  - `provider`
  - `modelId`
  - `thinkingLevel`
  - `systemPrompt`
- Allow defaults to be manually applied to existing agents through an explicit user action.
- Preserve the current graph/canvas workflow when switching back from settings.

## Non-Goals

- Do not add URL routing or deep linking for settings sections in this change.
- Do not turn settings into a full editor for every agent field.
- Do not make defaults automatically overwrite existing agents when changed.
- Do not include API keys, sessions, or settings data in graph import/export.
- Do not redesign node editing, the chat drawer, or graph interactions beyond what is required to support view-mode switching.

## Current Constraints

- The app currently uses local component state in `App.tsx` to toggle a `SettingsModal`.
- There is no routing layer today.
- App-level actions such as export/import/test fixture currently live in `Sidebar.tsx`.
- API keys already persist in `settings-store.ts`.
- New nodes are created through `graph-store.ts` and `getDefaultNodeData()`.
- `getDefaultNodeData()` is also used during migration/import, so it should remain schema-oriented rather than reading user-authored app settings.
- Sessions, graph state, and API keys persist in separate client-side stores.

These constraints make an app-level view mode a better fit than introducing a route system or stretching the existing modal into a larger overlay.

## Product Decisions Captured From Conversation

- The settings experience should be a dedicated workspace, not a modal or slide-over.
- The settings page should cover both current app operations and broader app-level preferences.
- Agent defaults should be real in v1, not just stubbed.
- Defaults should include:
  - `provider`
  - `modelId`
  - `thinkingLevel`
  - `systemPrompt`
- Changing defaults should affect new agents by default.
- Existing agents should only be updated through a separate manual action.
- Current sidebar app actions should move into Settings rather than stay duplicated in the canvas sidebar.

## App Shell And Navigation

### Top-Level View Mode

Add a top-level app view mode with two states:

- `canvas`
- `settings`

`App.tsx` should own this state.

### Canvas Mode

In `canvas` mode, the app behaves the same way it does today:

- node palette in the left sidebar
- graph canvas in the center
- properties panel on the right when a node is selected
- chat drawer when opened

### Settings Mode

In `settings` mode:

- the left sidebar becomes settings navigation
- the center workspace becomes the settings page
- the old `SettingsModal` is removed
- canvas-only UI such as the properties panel and chat drawer is hidden

Important consideration: hidden canvas UI should be treated as view-only suppression, not destructive teardown of persisted graph/session state. Returning to canvas should preserve the user’s graph and selection context as much as practical.

### Entry And Exit

- Clicking the gear button enters `settings` mode.
- The settings workspace should provide a visible `Return to Canvas` action.
- The gear button should no longer open a modal.

## Settings Information Architecture

The settings sidebar should expose these sections:

1. `Providers & API Keys`
2. `Model Catalog`
3. `Defaults`
4. `Data & Maintenance`

The main content area should show one section at a time with:

- page title
- short explanatory copy
- grouped cards/forms for related controls

This keeps the workspace consistent with the current app shell while giving app-level configuration enough structure to scale.

## Section Design

### Providers & API Keys

This section replaces the current modal content.

Each supported provider should have:

- a masked input
- a show/hide toggle
- provider-specific helper text when needed

`Ollama` should remain clearly labeled as local/no key required.

Keys continue to be stored locally in the browser through the settings store.

### Model Catalog

This section makes OpenRouter discovery visible and user-driven instead of purely background behavior.

It should show:

- whether OpenRouter sync is available
- whether a sync is in progress
- the last known success/error state
- a manual refresh action

Assumption: this change continues to support provider-backed discovery only for OpenRouter.

Important consideration: catalog sync failure must be non-blocking. The user should still be able to configure and run agents with built-in/static model options and manual model IDs where supported elsewhere in the app.

### Defaults

This section defines real app-level defaults for newly created agents.

Editable fields:

- `provider`
- `modelId`
- `thinkingLevel`
- `systemPrompt`

These defaults should be applied when a new agent node is created.

This section should also include an explicit action:

- `Apply defaults to existing agents`

That action must require confirmation.

Important consideration: applying defaults to existing agents can overwrite intentional customization. The UI should make the scope explicit and, if practical in implementation, allow per-field selection before the change is confirmed.

### Data & Maintenance

This section becomes the new home for app-level operational actions that currently live in the canvas sidebar.

It should include:

- `Export Graph`
- `Import Graph`
- `Load Test Fixture`
- clear graph data
- clear chat/session data
- clear app settings
- reset everything

Reset actions should be separated by scope so they are safer and easier to understand.

Important consideration: destructive actions should require confirmation and use precise labels so users understand whether they are deleting graph state, sessions, app settings, or all persisted data.

## Defaults Behavior

### New Agent Creation

When a new agent node is created:

- start from schema defaults from `getDefaultNodeData('agent')`
- overlay app-level agent defaults from settings
- preserve existing node creation behavior for non-agent nodes

This keeps schema defaults and user-authored defaults separate.

### Existing Agents

Changing settings defaults should not immediately mutate existing agents.

Instead, the user may manually trigger `Apply defaults to existing agents`.

That action should only update these fields:

- `provider`
- `modelId`
- `thinkingLevel`
- `systemPrompt`

It should never change:

- agent names
- descriptions
- tags
- capability overrides
- peripheral node relationships

## Import/Export Behavior

Graph import/export remains graph-only for this change.

Do not include:

- API keys
- settings defaults
- model catalog cache
- sessions

Important consideration: extending import/export to include settings would create bigger trust, privacy, and migration questions and is intentionally out of scope here.

## State And Data Flow

### App Shell State

`App.tsx` should own the top-level `canvas/settings` mode and pass it into the sidebar and main workspace.

### Settings State

Extend `settings-store.ts` to persist:

- `apiKeys`
- `agentDefaults`

`agentDefaults` should represent only the approved app-level fields:

- `provider`
- `modelId`
- `thinkingLevel`
- `systemPrompt`

### Graph Integration

`graph-store.ts` should own:

- applying settings defaults when creating a new agent node
- manually applying defaults to existing agents

`getDefaultNodeData()` should remain a pure schema-default helper and should not read from app settings.

This boundary prevents migration/import code from becoming dependent on user-authored settings state.

## UI Behavior Expectations

- Switching into settings hides the properties panel and chat drawer.
- Switching back to canvas restores the normal graph workspace.
- The settings workspace should feel like part of the existing app shell, not a separate application.
- Errors for import/model sync should appear inline in the relevant settings section rather than as global blocking failures.
- The old settings modal should be fully removed to avoid duplicate entry points.

## Error Handling

### API Keys

- Missing key is a valid state.
- Invalid or empty keys should not break the settings page itself.

### Model Catalog

- No OpenRouter key: do not sync and show an explanatory idle state.
- Sync in progress: show loading state.
- Sync failure: show inline non-blocking error and allow retry.

### Import

- Invalid graph file should surface as a clear in-page error state rather than relying only on a browser alert.

### Destructive Actions

These actions require confirmation:

- apply defaults to existing agents
- clear graph
- clear sessions
- clear app settings
- reset everything

## Testing Strategy

Recommended automated coverage:

- settings-store persistence for API keys and agent defaults
- new agent creation using app-level defaults
- manual apply-defaults behavior on existing agents
- app shell switching between `canvas` and `settings`
- non-agent node creation remaining unaffected by agent defaults
- OpenRouter sync state handling in the settings workspace

Important consideration: the highest-risk behavior is not the presence of a new page but whether defaults are applied in the right places and only when intended.

## Implementation Outline

1. Replace modal-based settings entry with an app-level `canvas/settings` mode in `App.tsx`.
2. Split the sidebar so it can render either the node palette or settings navigation.
3. Introduce a dedicated settings workspace component with section-based rendering.
4. Extend the settings store with `agentDefaults`.
5. Update agent creation in the graph store so new agent nodes receive app-level defaults.
6. Add a graph-store action to manually apply defaults to existing agents.
7. Move app-level actions from the canvas sidebar into the `Data & Maintenance` section.
8. Surface OpenRouter model catalog sync state and refresh controls in `Model Catalog`.
9. Remove the old `SettingsModal`.
10. Add tests for store persistence, default application, and app-shell mode switching.

## Risks

- If defaults are applied in `getDefaultNodeData()` instead of at agent-creation time, imports/migrations may become incorrect or user-settings-dependent.
- If settings mode destroys too much transient UI state, returning to canvas may feel disruptive.
- If destructive maintenance actions are not clearly scoped, users may delete more data than intended.
- If `Apply defaults to existing agents` is too aggressive, it may overwrite deliberate per-agent configuration.

The design reduces these risks by keeping schema defaults separate, requiring explicit confirmation for destructive actions, and treating defaults application to existing agents as a manual workflow rather than an automatic side effect.
