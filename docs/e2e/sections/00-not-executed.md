# Tests Not Fully Executed (Live UI)

<!-- last-verified: 2026-05-10 -->

This file consolidates every test from `01-canvas-and-graph.md`, `02-property-editors.md`, `03-settings-workspace.md`, `04-chat-and-sessions.md`, `05-shared-resolution.md`, `06a-runtime-coordination.md`, `06b-engines-hooks-comms.md`, `07a-api-storage-sessions.md`, and `07b-tools-hitl-cli.md` whose acceptance criteria could **not** be fully exercised as a real user-clickthrough in the live UI during the chrome-devtools-MCP runs. Each row records:

- What blocked the live exercise.
- The fallback method (if any) and what was actually verified.
- What still needs a real human pass before the TC can be considered fully covered.

Companion docs:
- [01-canvas-and-graph.md](./01-canvas-and-graph.md) / [01-findings.md](./01-findings.md)
- [02-property-editors.md](./02-property-editors.md) / [02-findings.md](./02-findings.md)
- [03-settings-workspace.md](./03-settings-workspace.md) / [03-findings.md](./03-findings.md)
- [04-chat-and-sessions.md](./04-chat-and-sessions.md) / [04-findings.md](./04-findings.md)
- [05-shared-resolution.md](./05-shared-resolution.md) / [05-findings.md](./05-findings.md)
- [06a-runtime-coordination.md](./06a-runtime-coordination.md) / [06a-findings.md](./06a-findings.md)
- [06b-engines-hooks-comms.md](./06b-engines-hooks-comms.md) / [06b-findings.md](./06b-findings.md)
- [07a-api-storage-sessions.md](./07a-api-storage-sessions.md) / [07a-findings.md](./07a-findings.md)
- [07b-tools-hitl-cli.md](./07b-tools-hitl-cli.md) / [07b-findings.md](./07b-findings.md)
- Master roll-up: [`E2E_TEST_FINDINGS.md`](../E2E_TEST_FINDINGS.md) (covers P1 smoke, CC.1–CC.12 cross-cutting, R-01..R-32 cross-walk, and UAT.1..UAT.10 with explicit FAIL on UAT.10)

## Summary

| Section | Total TCs | Not fully live | % |
|---|---|---|---|
| §1 Canvas & Graph | 25 | 11 | 44% |
| §2 Property Editors | 25 | 5 | 20% |
| §3 Settings Workspace | 30 | 8 | 27% |
| §4 Chat & Sessions | 30 | 14 | 47% |
| §5 Shared Resolution | 48 | 4 | 8% |
| §6A Runtime Coordination | 20 | 4 | 20% |
| §6B Engines / Hooks / Comms | 37 | 9 | 24% |
| §7A REST / WS / Auth / Storage / Sessions | 22 | 5 | 23% |
| §7B Tools / HITL / Skills / SAM CLI | 26 | 9 | 35% |
| **Combined** | **263** | **69** | **26%** |

## Blocker classes

| Class | Description | Affected TCs |
|---|---|---|
| **B1 — xyflow handle drag (pointer events)** | xyflow's connect-drag uses pointer events with capture; synthetic `PointerEvent` dispatch doesn't reach the internal connection state machine. The prior P3 run logged the same instrumentation note. | TC1.4, TC1.5, TC1.6, TC1.25 |
| **B2 — Resize-handle pointer drag** | `useRightAnchoredResize` uses pointer capture on the handle; synthetic events don't propagate. | TC1.10 |
| **B3 — CSS-only :hover** | Sidebar expand and edge-X delete button visibility are CSS `:hover` (group-hover / direct hover) — synthetic `mouseenter`/`mouseover` do not satisfy CSS `:hover` matching. | TC1.11, TC1.24 |
| **B4 — Real DnD visual** | The drag image attached to a palette tile is set via `dataTransfer.setDragImage()` and is only paintable during a real OS-level drag; not observable to scripted automation. | TC1.12 |
| **B5 — UI not wired** | Action exists in code but has no UI control (button, menu item, or shortcut) reachable from the canvas. | TC1.17, TC1.22 |
| **B6 — Volatile, observation-only** | The thing being observed is a transient React state during a drag (the `SnapHighlight` overlay) — present only between `pointerdown` and `pointerup`. The MCP `drag` tool succeeds at the snap commit but the overlay's pre-commit visibility cannot be sampled. | TC1.3 |
| **B7 — Destructive (intentionally skipped)** | Spawning an external Chrome process or invoking a destructive backend op was deliberately not exercised. | TC2.11 |
| **B8 — Fixture / live-data dependency** | The variant under test depends on backend state that isn't reproducible on the local dev setup (e.g., a multi-plugin provider registry, a model whose metadata reports a specific `reasoningSupported`/`contextWindow`, or a partial `userModels` map). | TC2.14 (inherited variant), TC2.25, TC3.10 (filter discrimination), TC3.14 |
| **B9 — Multi-step UI affordance not all asserted** | The TC has multiple sub-asserts; one or more sub-assert reaches an element that the snapshot/finder couldn't isolate. | TC2.7, TC2.22 |
| **B10 — Sandbox-blocked credential / on-disk mutation** | Mutating user credentials (api keys) or deleting on-disk session/transcript data via REST PUT is denied without explicit user reauthorization on each run. | TC3.9, TC3.17, TC3.27 (live), TC3.28, TC3.29 |
| **B11 — Cross-section runtime dependency** | The TC verifies behavior in a downstream subsystem (chat HITL, runtime mirror) that lives in a later section's scope. | TC3.20, TC3.30 |
| **B12 — Live-stream timing dependency** | The TC needs an in-flight chat stream to observe a UI behavior (e.g., text-reveal speed change applies live to a streaming response). | TC3.21 (live preview only), S4.23, S4.24 |
| **B13 — Cost-of-fresh-turn / API-call budget** | Live reproduction requires sending a brand-new prompt to the model, paying for it, and exposing the user's account. Replays from existing transcripts only cover the `applied / completed` state, not the `pending / discarded / error / mid-stream` states. | S4.8, S4.10, S4.11, S4.12, S4.20 (coloring crossover), S4.22, S4.28, S4.29 |
| **B14 — Tooling visibility (DevTools-MCP can't see WebSocket frames)** | `list_network_requests` returns 0 entries for `resourceTypes: ["websocket"]` and 0 entries via `performance.getEntriesByType('resource').filter(e => e.initiatorType === 'websocket')`. Real WebSocket connections (verified via source: `new WebSocket(this.url)` in `agent-client.ts:31`) cannot be inspected at the frame level. | S4.2 (transport verification — F-01 needs re-evaluation) |
| **B15 — Browser environment incompatibility for Node-only paths** | The browser-side `import * as posixPath from 'path'` does not expose `.posix`, and `process.env` is undefined. Code paths that depend on either crash when invoked from `evaluate_script` even though they work fine server-side. | T9 (connector buildEnv reads process.env), T24/T25 (sub-agent skills merge + working-directory derivation use posix.join) |
| **B16 — Module-instance separation between dynamic import and static import** | `evaluate_script`'s dynamic `import()` returns a different module singleton from the one bound by the resolver's static `import` at top of file. Mutations to a Zustand store reached via dynamic import do not propagate to the resolver's view of the same store. | T37 (catalog-store branch of toolsSummary filter) |
| **B17 — WS-driven managed-agent registration unreachable from eval scripts** | `mgr.listAgents()` only contains agents that completed an `agent:start` round-trip via WebSocket. The `chrome-devtools-mcp` `evaluate_script` context can dynamically import `/server/...` and `/shared/...` modules (Vite-served), but `/src/client/index.ts` (the singleton `agentClient`) is not exposed at the resolved bare-specifier path; spawning a fresh `WebSocket(/ws)` from the eval context didn't complete handshake before the dev server was killed. The chat drawer's Open Chat path does WS-attach but `evaluate_script` cannot follow that lifecycle deterministically. | TC6B.29, TC6B.30 |
| **B18 — Graph-config gate (no node of required type exists)** | The TC verifies a backend route or scheduler whose code path exists but only fires when a corresponding node type is present in the resolved `AgentConfig`. The default node palette doesn't expose webhook nodes, and per CLAUDE.md cron is not in the default palette either. Reproducing requires a custom graph (REST/import driven). | TC6B.31, TC6B.32, TC6B.33, TC6B.34, TC6B.35, TC6B.36, TC6B.37 |

## §1 — Canvas, Graph & Connections

### TC1.3 — Hex-grid snap visual + commit
- **Spec:** Begin dragging a node; observe the colored hex outline shifts cell by cell; on drop in occupied cell, snap to nearest free ring.
- **Blocker:** B6 — `SnapHighlight` overlay state is React-internal and only present between `pointerdown` and `pointerup` of a real drag.
- **Verified:** Snap commit was reproduced by TC1.16 (memory dragged toward storage's cell snapped to nearest free cell at (225, 692.82); storage was not displaced).
- **Still needed:** Manual visual check that the colored hex outline tracks the cursor live during the drag.

### TC1.4 — Connect peripheral to agent (handle drag)
- **Spec:** Drag from provider's right handle onto agent's left handle.
- **Blocker:** B1.
- **Verified:** Edge persisted via REST PUT with deterministic id `edge_prov1_a1` rendered with correct `aria-label`, `animated: true`, source-color stroke, removable X.
- **Still needed:** A real human drag from a `react-flow__handle.source` to a `react-flow__handle.target` to confirm xyflow's onConnect actually fires through the user click path (not just the data layer).

### TC1.5 — Reject peripheral → peripheral connections
- **Spec:** Drag from a peripheral source handle toward another peripheral; observe drop indicator goes red, no edge created.
- **Blocker:** B1.
- **Verified:** Two structural guards: (a) `BasePeripheralNode` renders only `Position.Right` source — no target handle exists to drop on; (b) `isValidConnection` ([FlowCanvas.tsx:83-90](../../../src/canvas/FlowCanvas.tsx#L83)) returns `false` for any non-agent target. Confirmed via handle topology + code read.
- **Still needed:** Manual visual confirmation that xyflow renders the red rejection indicator on hover.

### TC1.6 — Sub-agent peripheral allow-list
- **Spec:** Connect tools→sub-agent (allowed) and memory→sub-agent (rejected).
- **Blocker:** B1.
- **Verified:** Allow-list rule confirmed in [graph-store.ts:297-301](../../../src/store/graph-store.ts#L297). Both edges injected via REST PUT — both render at hydration, which is the source of new finding **F-08** (hydration doesn't enforce the allow-list).
- **Still needed:** Manual drag attempts confirming xyflow's onConnect rejects the disallowed source types.

### TC1.10 — Properties panel resize persists
- **Spec:** Drag the resize handle to widen the panel; reload; verify width persisted.
- **Blocker:** B2.
- **Verified:** Persistence path was tested by writing `propertiesPanelWidth: 480` to localStorage and reloading — panel rendered at 480px wide. The state→DOM rebuild path is correct.
- **Still needed:** Manual drag to confirm `useRightAnchoredResize` actually updates the store via real pointer drag (not just from a programmatic localStorage seed).

### TC1.11 — Hover sidebar to expand
- **Spec:** Hover over palette sidebar; expect width 84px → 256px and label reveal.
- **Blocker:** B3.
- **Verified:** Sidebar `aside.group` has `w-[84px] hover:w-64` Tailwind classes; initial width 84px. Behavior is CSS-driven, no JS state.
- **Still needed:** Manual hover confirmation. (Low risk — this is plain Tailwind hover.)

### TC1.12 — Drag image scales with viewport zoom
- **Spec:** Zoom canvas to 50% / 200%; begin a palette drag; observe drag image scales `HEX_WIDTH * zoom`.
- **Blocker:** B4.
- **Verified:** Code path confirmed in `Sidebar.tsx:87` — drag preview is set with `dataTransfer.setDragImage` at `HEX_WIDTH * zoom`. Static reading only.
- **Still needed:** Manual visual inspection at multiple zoom levels.

### TC1.17 — `applyPatch` add-and-rollback transaction
- **Spec:** Apply valid patch (commit); apply throwing patch (rollback to pre-patch snapshot).
- **Blocker:** B5 — `applyPatch` is a Zustand store action with no UI button reachable from the canvas. Only callable from React internals or via the SAMAgent NL→patch flow.
- **Verified:** Nothing at runtime in this run.
- **Still needed:** Cover via §9 capstone UAT.4 (SAMAgent natural-language workflow patch). Alternatively, expose `useGraphStore` on `window` in a test build to call `applyPatch` directly.

### TC1.22 — `clearGraph` resets to empty
- **Spec:** Invoke `clearGraph()`; expect canvas empties and selection clears.
- **Blocker:** B5 — `clearGraph` has no UI button; the `Data & Maintenance` reset in Settings may invoke it but was not exercised (destructive).
- **Verified:** REST proxy: PUT empty graph + clear localStorage + reload → empty canvas (TC1.1's path). The visible effect of `clearGraph` is reproduced; the action's runtime side-effects (does it call `destroyAgent` for live runtimes?) are still F1.29's "behavior unclear" caveat.
- **Still needed:** Either expose `clearGraph` for testing or document the F1.29 runtime-teardown behavior via a controlled scenario where an agent has an active session.

### TC1.24 — Edge-delete X visibility on hover
- **Spec:** Hover the edge path; X button fades in.
- **Blocker:** B3.
- **Verified:** 11 X buttons rendered (one per edge) inside `.react-flow__edgelabel-renderer`, all with computed `opacity: 0` from the `opacity-0` Tailwind class. CSS hover→opacity-1 transition is wired.
- **Still needed:** Manual hover confirmation.

### TC1.25 — `isValidConnection` vs `onConnect` parity
- **Spec:** Drag from a tools source handle toward a sub-agent target; observe whether the visual indicator allows the drop and whether `onConnect` ultimately commits.
- **Blocker:** B1.
- **Verified:** Static code read confirms inconsistency: `isValidConnection` ([FlowCanvas.tsx:83-90](../../../src/canvas/FlowCanvas.tsx#L83)) accepts only `target.type === 'agent'`; `onConnect` ([graph-store.ts:283-310](../../../src/store/graph-store.ts#L283)) accepts both `agent` and `subAgent` (with allow-list).
- **Still needed:** A real drag attempt to confirm the visible UX outcome (is the user denied the drop? if they manage to drop on a sub-agent, does the edge commit?).

## §2 — Property Editors

### TC2.7 — System Prompt Preview round-trips through server
- **Spec:** Click "View full prompt"; expect modal with sections, expand-all/collapse-all controls, total tokens at the bottom.
- **Blocker:** B9 — modal-and-tokens path verified, but the explicit `Expand all` / `Collapse all` button text was not matched in the snapshot. The controls likely use icons.
- **Verified:** Modal opens (heading "System Prompt"), section list rendered from `/api/agents/:id/resolved-system-prompt`, total-tokens read-out present, Escape key closes.
- **Still needed:** Manual click on the collapse/expand affordances to confirm they toggle section visibility.

### TC2.11 — Browser CDP launcher posts to backend
- **Spec:** Click "Launch Chrome for CDP"; expect POST `/api/browser/launch-chrome`, "Chrome launched" message, and `cdpEndpoint` populated.
- **Blocker:** B7 — clicking would spawn a Chrome process on the user's machine. Intentionally skipped to avoid side effects on the live dev environment.
- **Verified:** CTA visible inside the browser sub-page (TC2.10).
- **Still needed:** Manual click during a session where launching Chrome is intended.

### TC2.14 — Context Engine inherits token budget when connected
- **Spec:** Connect CE → agent → provider with a model that reports `contextWindow`; expect Token Budget to flip from editable to a read-only "inherited" badge.
- **Blocker:** B8 — only the no-connection baseline variant was tested. Triggering the inherited variant requires a model with discovered `contextWindow` metadata via `useModelCatalogStore`, which depends on a synced OpenRouter catalog with a specific model selected on the parent agent.
- **Verified:** Default 128000 editable; "Connect to an agent to inherit from model" hint rendered.
- **Still needed:** Connect CE → agent that has a Provider with synced catalog and a chosen model whose `contextWindow` is known; verify the read-only inherited badge appears with correct token count.

### TC2.22 — Sub-Agent name regex live validation
- **Spec:** Type an invalid name like `1bad` → amber regex error; type `researcher` → error clears.
- **Blocker:** B9 — the name input finder in the test script didn't match the rendered input element (the input may be wrapped or use a non-standard selector); the dispatch of a value-set+input-event didn't reach it.
- **Verified:** Other parts of TC2.22 passed (no-tools and no-parent banners; 5 checkboxes including recursive-default-off).
- **Still needed:** Manual typing in the name field with `1bad` and `researcher` to confirm the regex error/clear behavior matches `SUB_AGENT_NAME_REGEX = /^[a-z][a-z0-9_-]{0,31}$/` from `shared/sub-agent-types.ts`.

### TC2.25 — Provider switching resets dependent fields
- **Spec:** Switch the Provider plugin select; expect `authMethodId`, `envVar`, `baseUrl` to reset to the new plugin's first auth method's defaults.
- **Blocker:** B8 — the dev backend has only one provider plugin registered (`openrouter`). Server log: `[Providers] No providers.json found at ...providers.json; loaded 1 default plugin(s).` Single-option select can't exercise switching.
- **Verified:** Reset behavior verified statically in [ProviderProperties.tsx:33-42](../../../src/panels/property-editors/ProviderProperties.tsx#L33).
- **Still needed:** A `providers.json` with at least 2 plugins (e.g., openrouter + anthropic); then switch and observe the cascade reset.

## §3 — Settings Workspace

### TC3.9 — Model catalog sync — bad key
- **Spec:** With invalid OpenRouter key, click Sync → expect 400/error rendered as red banner with backend message.
- **Blocker:** B10 — installing an invalid key requires PUTting empty/garbage `apiKeys.openrouter`, which the sandbox refuses without explicit reauth.
- **Verified:** Nothing live. Source of error rendering at `ModelCatalogSection.tsx` (red banner from `errors[key]` in store) confirmed in earlier reading.
- **Still needed:** Re-run with explicit user authorization to mutate the OpenRouter key for the duration of the sync test, then restore.

### TC3.10 — My Enabled vs All Models filter (discrimination)
- **Spec:** When `userModels` is non-empty, toggle is shown and persists view between searches; when empty, toggle hidden, fall back to "All".
- **Blocker:** B8 — the user's OpenRouter account has the same set of models enabled as the full catalog (367 of 367), so the toggle's filtering effect is not visually distinguishable on this run.
- **Verified:** Toggle UI wires correctly: button-pair appears after sync, switching changes the active state, both views render. The empty-userModels fall-back was confirmed before the first sync (toggle hidden).
- **Still needed:** A test account with a *partial* enabled-set (say 5 models out of 367) so filtering can be visually verified.

### TC3.14 — Defaults — Provider plugin auto-fill
- **Spec:** Change Provider Plugin in Defaults → `authMethodId`, `envVar`, `baseUrl` auto-update from registry first auth method.
- **Blocker:** B8 — only `openrouter` plugin loaded server-side. Single-option select.
- **Verified:** `DefaultsSection.tsx` calls `useProviderRegistryStore` for `authMethodId`/`envVar` on plugin change (static read).
- **Still needed:** Same as TC2.25 — populated `providers.json`.

### TC3.17 — SAMAgent — provider key cleared after selection
- **Spec:** Pick a model, then clear that provider's key in Providers & API Keys → return to SAMAgent → amber banner "no API key configured" shows.
- **Blocker:** B10 — clearing an API key is a credential mutation the sandbox blocks without explicit reauth.
- **Verified:** Static read of [SamAgentSection.tsx:26-28](../../../src/settings/sections/SamAgentSection.tsx) confirms the amber-banner branch when `getApiKey(pluginId).trim() === ''`.
- **Still needed:** Authorized run that clears + restores the key around the assertion.

### TC3.20 — Safety policy → chat HITL effect
- **Spec:** With `allowDisableHitl=true`, in a Tools node uncheck `confirm_action`; run an agent; verify HITL banner does NOT appear before a state-mutating tool.
- **Blocker:** B11 — chat-side HITL banner rendering is in the §4 (chat / runtime) scope.
- **Verified:** Settings-side surface (`safety.allowDisableHitl` toggle behavior) verified in TC3.18.
- **Still needed:** Cover during §4.

### TC3.21 — Appearance live preview (drag slider while streaming)
- **Spec:** Open ChatDrawer with an in-flight stream → drag Reveal speed slider → text streams visibly faster/slower without reload.
- **Blocker:** B12 — needs an active streaming response to observe live speed change.
- **Verified:** Default values, structural mute behavior on toggle-off, range bounds (TC3.21 structural).
- **Still needed:** Manual run during a streaming chat reply, dragging the slider.

### TC3.27 — Reset Everything (live)
- **Spec:** Confirm dialog → graph cleared, all sessions cleared, settings reset to defaults, model catalogs cleared. Color overrides survive.
- **Blocker:** B10 — clearing on-disk session data under `~/.simple-agent-manager/storage/` was not authorized for this run; safer to omit the live click than risk losing transcripts.
- **Verified:** Static read confirms `DataMaintenanceSection.tsx:170-173` calls `clearGraph + resetAllSessions + resetSettings + clearAllCatalogs`; none touch `localStorage['sam:color-overrides']` (managed by `applyColorOverrides`/`saveColorOverrides`). So the color-override survival claim is correct on the code path.
- **Still needed:** Authorized destructive run with sessions backed up beforehand. Or implement `Reset Everything (preserve sessions)` as a safer dev-mode variant.

### TC3.28 — Server-down save behavior
- **Spec:** Stop backend → change a setting → no error UI surfaces (silent catch). Reload page → setting reverts to last server value.
- **Blocker:** B10 — stopping the backend mid-run would interfere with every other in-flight test and is not authorized for this pass.
- **Verified:** Source confirms `saveSettings` swallows errors at [settings-store.ts:97-99](../../../src/settings/settings-store.ts#L97-L99).
- **Still needed:** A controlled run where the backend is killed for ~5s while a setting is edited, then restarted and the page reloaded.

### TC3.29 — `/api/settings` 500 on load
- **Spec:** Make backend return 500 → `loadFromServer` catches; UI loads defaults; `loaded=true` is still set so SAMAgent can proceed.
- **Blocker:** B10 — fault injection at the running backend not authorized.
- **Verified:** Source confirms the catch in `useSettingsStore`.
- **Still needed:** A backend-side test hook (e.g., `?inject=500-on-settings-load` query flag) so the 500 path can be exercised without modifying the live server.

### TC3.30 — PUT settings persists safety to runtime mirror
- **Spec:** Toggle Dangerous Fully Auto → start a new agent run → verify the AgentManager observed the new value (server/index.ts:626-631 mirror).
- **Blocker:** B11 — observing the runtime mirror requires actually starting an agent, which belongs in §4.
- **Verified:** Settings-side toggle propagation to PUT confirmed in TC3.18.
- **Still needed:** Cover during §4 with an agent run-start log inspection.

## §4 — Chat Drawer, Sessions, SAM Agent UI

### S4.2 — Transport verification (F-01 regression check)
- **Spec:** verify WS frames AND REST calls; flag regression if WS absent.
- **Blocker:** B14 — DevTools-MCP doesn't surface WebSocket frames in `list_network_requests` or `performance.getEntriesByType('resource')`. Real WS is instantiated per [agent-client.ts:31](../../../src/client/agent-client.ts#L31).
- **Verified:** REST polling on `/api/sessions/.../transcript` is observable (~18 requests per chat session, URL ~780 bytes).
- **Still needed:** Inspect WS frames via raw browser DevTools or a separate WS-aware tool to confirm `agent:prompt` / `message:delta` flow as expected. Re-classify F-01 from "regression" to "tooling artifact" if confirmed.

### S4.8 — Tool error
- **Spec:** Tool result that errors → red recolor + `AlertTriangle` icon.
- **Blocker:** B13 — needs a fresh prompt that triggers a failing tool call (e.g., reading a non-existent file). Costly extra API turn.
- **Verified:** Static path: `MessageBubble` renders error styling when `Message.isError === true`.
- **Still needed:** A dev fixture or a "kill this tool" knob that returns a controlled error without spending API credit.

### S4.10 — HITL confirm
- **Spec:** Trigger `kind:'confirm'` HITL → amber banner + Yes/No + countdown; Yes → synthetic user `yes` + agent resumes.
- **Blocker:** B13 — past confirm_action calls visible in transcript but no live banner active. Live trigger needs a fresh prompt that requires confirmation, then human-in-the-loop click within timeoutMs.
- **Verified:** Code-path confirmed in [HitlBanner.tsx](../../../src/chat/HitlBanner.tsx); past confirm_action tool messages render in the transcript.
- **Still needed:** Fresh prompt + manual interaction during the same run.

### S4.11 — HITL text + manual yes/no parsing
- **Spec:** Type `maybe` during confirm-HITL → `agent:error` ("non-yes/no answer"); type `yes` → resumes.
- **Blocker:** B13.
- **Verified:** Nothing live.
- **Still needed:** Same as S4.10 plus typing alternate values.

### S4.12 — HITL timeout
- **Spec:** Set short timeoutMs, wait → `hitl:resolved` with `outcome:'cancelled', reason:'timeout'` clears banner.
- **Blocker:** B13 (fresh turn) + waiting for the timeout countdown to elapse.
- **Verified:** Nothing live.
- **Still needed:** Fresh HITL with short timeoutMs + observe the countdown reach 0.

### S4.13 — HITL across reconnect
- **Spec:** Trigger HITL, kill backend briefly, restart → drawer issues `hitl:list` and banner re-renders.
- **Blocker:** B10 (backend disruption not authorized) + B13.
- **Verified:** Nothing live.
- **Still needed:** Authorized backend restart window; fresh HITL.

### S4.16 — Invalid model id error rendering (F-03 / F-06)
- **Spec:** Use a default modelId (`anthropic/claude-sonnet-4-20250514`) → assistant `Error: …is not a valid model ID`; persists across reload.
- **Blocker:** Already triple-confirmed in §1/§2/§3 via the settings-store path; live reproduction here was deferred to avoid extra graph mutation outside §3's scope.
- **Verified:** Source path: `agent:error` / `lifecycle:error` adds an `Error: …` assistant message per F4.13.
- **Still needed:** Single live confirm if/when re-running §4 — set scribe `modelId='anthropic/claude-sonnet-4-20250514'` for one turn, observe the error message, restore.

### S4.17 — Provider down / network blip
- **Spec:** Mid-stream backend kill → `connectionStatus` flips to `connecting`/`disconnected` and chat-blocked overlay surfaces.
- **Blocker:** B10 — backend kill not authorized for this run.
- **Verified:** Nothing live.
- **Still needed:** Authorized backend restart window during a streaming turn.

### S4.18 — Auto-close drawer on agent deletion
- **Spec:** Delete agent A from canvas while chat A is open → `chatAgentNodeId` clears, drawer unmounts.
- **Blocker:** Destructive (deletes a real agent + its on-disk session data).
- **Verified:** Source: [graph-store.ts:474-490](../../../src/store/graph-store.ts) clears `chatAgentNodeId` for matching agent in `deleteNode`.
- **Still needed:** A scratch agent (drag → delete with chat open) on a fresh-graph fixture.

### S4.20 — Context usage panel: long thread coloring
- **Spec:** Push usage past 50% (amber) and 80% (red).
- **Blocker:** B13 — would need to burn ~500K tokens in a single thread on the user's OpenRouter key.
- **Verified:** Structural — panel + breakdown + Top skills/Top tools render correctly with the current 1% / 12.3K / 1.0M state.
- **Still needed:** Either a fixture that injects a fake high-usage `context:usage` event, or a long real thread.

### S4.22 — Compaction event surfaces
- **Spec:** Trigger compaction; observe inline amber "Compacting context…" pill between `compaction:start` and `compaction:end`.
- **Blocker:** B13 — needs real compaction trigger (long thread or specific tool).
- **Verified:** Nothing live.
- **Still needed:** A fixture that emits `compaction:start/end` directly, or a long thread.

### S4.23 — Animation speed setting changes reveal (live preview)
- **Spec:** Drag Reveal speed slider while a stream is in flight; observe text streams faster/slower without reload.
- **Blocker:** B12 + B13 — needs an in-flight stream long enough to drag the slider during it; chrome-devtools-mcp synthetic events don't reliably drive a `<input type="range">` mid-stream.
- **Verified:** Settings-side controls verified in §3 TC21 (range bounds, mute on toggle-off).
- **Still needed:** Manual test with a long streaming response.

### S4.24 — Streaming markdown safety (mid-stream)
- **Spec:** Take screenshots while a stream is mid-render; verify no raw `*` / `[` / unclosed fence glyphs.
- **Blocker:** B12 — frame-level inspection during a slow stream.
- **Verified:** Final-rendered transcripts are clean; the `findSafeRevealCount` + `autoClose` code path is wired.
- **Still needed:** Frame-level visual check (Playwright with screenshot intervals during a deliberately slow stream).

### S4.26 — Per-message delete
- **Spec:** Hover message → trash → REST DELETE `/api/sessions/.../messages/{id}` and row disappears.
- **Blocker:** Destructive on user's transcript data.
- **Verified:** `Delete message` button renders on every message row (multiple buttons confirmed via DOM scan).
- **Still needed:** Click in a scratch session with throwaway content.

### S4.28 — SAM Agent: discard patch
- **Spec:** Discard apply card → canvas unchanged, card flips to `Discarded`, server informed via `samAgent:patchState`.
- **Blocker:** B13 — needs a fresh patch-eliciting prompt; risky to send a destructive prompt just to discard.
- **Verified:** SAMAgent transcript shows 3 prior `Applied` cards; the negative-path `Discarded` state is not yet exercised.
- **Still needed:** Send a benign patch-eliciting prompt and click Discard.

### S4.29 — SAM Agent: HITL
- **Spec:** Trigger HITL inside SAMAgent (e.g., destructive request) → amber banner above input.
- **Blocker:** B13 — needs fresh prompt that elicits HITL inside SAM.
- **Verified:** Nothing live.
- **Still needed:** Manually compose a SAMAgent prompt that triggers `confirm_action` server-side.

### S4.30 — SAM Agent clear
- **Spec:** Trash button → local view clears + server-side cleared after reconnect.
- **Blocker:** Would erase the user's existing 3-Apply-card SAM transcript; not authorized.
- **Verified:** Trash button visible (`title="Clear conversation"`); source: `samAgentClient.clear()` in `SAMAgent.tsx`.
- **Still needed:** Authorized destructive run.

## §5 — Shared Resolution Layer

### T9 — GitHub connector with token resolves to MCP entry (env materialization)
- **Spec:** Set `process.env.GITHUB_PERSONAL_ACCESS_TOKEN='tok'`, run resolver, assert `mcps[0].env.GITHUB_PERSONAL_ACCESS_TOKEN === 'tok'`.
- **Blocker:** B15 — `process.env` is `undefined` in the browser; `def.buildEnv(values)` throws.
- **Verified:** Static structure of the connector definition confirmed (`transport='stdio'`, `command='npx'`, `args=['-y','@modelcontextprotocol/server-github']`, `toolPrefix='github_'`, single var `tokenEnvVar`). Browser builds always emit `env: {}` for connectors as the spec calls out.
- **Still needed:** Run on the server (Node) where `process.env` is real, or shim the env read.

### T24 — Sub-agent skills merge with parent (live exercise)
- **Spec:** Parent skills `[a]`, sub dedicated skills `[b]` → `subAgents[0].skills = [a, b]`; same id in both → dedicated wins.
- **Blocker:** B15 — sub-agent code path crashes on `posixPath.posix.join` before reaching the skills-merge step in tests where parent has a `workingDirectory`.
- **Verified:** Static reading of [graph-to-agent.ts:85-89](../../../src/utils/graph-to-agent.ts#L85-L89) confirms the merge logic.
- **Still needed:** Server-side test, or browser-safe `posix.join` shim, then live verify.

### T25 — Sub-agent working directory derived (live exercise)
- **Spec:** Parent `workingDirectory:'/work'`, sub name `helper`, mode `inherit` → `workingDirectory === '/work/subagent/helper'`.
- **Blocker:** B15 — `posixPath.posix` is undefined in browser. Note B in §5 findings flags this as a real product issue: any user with `workingDirectory` + sub-agents would hit a browser-side resolve crash. Server-side runtime resolves are unaffected.
- **Verified:** Formula at [graph-to-agent.ts:138](../../../src/utils/graph-to-agent.ts#L138) confirmed.
- **Still needed:** Either fix the resolver to use a browser-safe path join, or run resolver only server-side.

### T37 — User-installed tool surfaced via catalog store (live exercise)
- **Spec:** Pre-populate `tool-catalog-store` with `{name:'my_tool', loaded:true}`, resolve agent with `enabledTools:['my_tool']`, assert prompt's `### Enabled tools` line includes `my_tool`.
- **Blocker:** B16 — dynamic `import()` and static `import` give different store instances; `setState` from `evaluate_script` doesn't reach the resolver's view.
- **Verified:** Static reading of [graph-to-agent.ts:448-454](../../../src/utils/graph-to-agent.ts#L448-L454) confirms `IMPLEMENTED_TOOL_NAMES.has(t) || catalogKnown?.has(t)` filter when `loaded === true`.
- **Still needed:** Either trigger via the live `loadToolCatalog()` call (which uses the resolver's static-imported store) and inspect the resulting prompt, or run the test from Node where there's no module-instance separation.

## §6A — Runtime Coordination

### TC6A.5 — Mid-stream abort (live)
- **Spec:** Abort while streaming → `lifecycle:error` `code:'aborted'`, HITL cancelled, diagnostic appended.
- **Blocker:** B13 + no UI Stop button observed during the §4 streams. `coordinator.abort(runId)` is reachable via WS `agent:abort` command but requires capturing the active runId mid-stream.
- **Verified:** Code path at [run-coordinator.ts:690](../../../server/agents/run-coordinator.ts#L690).
- **Still needed:** Manual abort during a long stream, or scripted WS sender with timing.

### TC6A.7 — Provider 429 / rate-limit
- **Spec:** Force a 429 → `lastApiError` captured → `lifecycle:error`.
- **Blocker:** B13 — would need to deliberately exhaust OpenRouter quota or route through a stub.
- **Verified:** Nothing live.
- **Still needed:** Stub provider that returns 429 on demand.

### TC6A.8 — Server restart preserves state (live)
- **Spec:** Boot, dispatch msg-A, kill server, boot again → agent-config.json on disk; in-memory RunRecord lost.
- **Blocker:** B10 — backend kill not authorized for this run.
- **Verified:** Static — `persistConfig` writes per-agent config; `restoreFromDisk` is **never called** on boot (F-12).
- **Still needed:** Authorized backend restart cycle.

### TC6A.13 — Run timeout (live)
- **Spec:** `timeoutMs:1000`, induce long stream → at 1s, runtime aborts, `lifecycle:error` with `code:'timeout'`.
- **Blocker:** B13 — needs a long-running provider response.
- **Verified:** Code path at [run-coordinator.ts:1667-1668](../../../server/agents/run-coordinator.ts#L1667).
- **Still needed:** Long-running prompt + scripted dispatch with short `timeoutMs`.

## §6B — Engines, Hooks, Sub-Agents, Comms

### TC6B.29 — REST channels list (live)
- **Spec:** `GET /api/agents/<id>/channels` returns array of `{channelKey, peerAgentId, peerAgentName, turns, sealed, sealedReason, lastActivityAt}` for every direct peer of a managed agent.
- **Blocker:** B17 — agents had to be lazy-started via WS `agent:start`. The chat drawer was opened (which usually triggers it), but `mgr.listAgents()` still returned 404 for both `node_YxU3zJ_wRI` and `node_jG2KVzrJOI`. A scratch `new WebSocket(/ws)` opened from `evaluate_script` never completed handshake; the singleton `agentClient` exposed by `/src/client/index.ts` couldn't be dynamically imported (only `/server/...` and `/shared/...` paths are reliably bare-resolvable in the eval context).
- **Verified:** Route logic statically — [agent-channels.ts:8-45](../../../server/routes/agent-channels.ts#L8-L45). Live 404 path confirmed (returns `{error: "agent not found"}`).
- **Still needed:** Live REST exercise after a successful WS `agent:start` of both peers, with the channel actually opened (zero-state response and post-channel-traffic response both verified).

### TC6B.30 — REST channel transcript (live)
- **Spec:** `GET /api/agents/<id>/channels/<channelKey>/transcript?limit=N` returns last N JSONL events; clamps to [1,500] default 50; 404 with `{error}` on missing channel.
- **Blocker:** B17 (same as TC6B.29).
- **Verified:** Route + clamp logic statically — [agent-channels.ts:47-59](../../../server/routes/agent-channels.ts#L47-L59).
- **Still needed:** Live request after a few sends so the response is non-empty.

### TC6B.31 — Webhook HMAC validation (live)
- **Spec:** Webhook with `secret` configured returns 401 on missing/invalid `X-Webhook-Signature`; 202 with `{runId, sessionKey: 'hook:<id>'}` on success.
- **Blocker:** B18 — graph contains no webhook config; `WebhookHandler.registerRoutes` iterates an empty list.
- **Verified:** Static — [webhook-handler.ts:24-46](../../../server/connections/webhook-handler.ts#L24-L46) including `crypto.timingSafeEqual` with length pre-check.
- **Still needed:** A graph with a `connectors`/webhook config wired to a managed agent; live HTTP POSTs against `/api/webhook/<path>` with all three header states.

### TC6B.32 — Webhook missing agent (live)
- **Spec:** Webhook configured for unknown agent id → 404 `{error: 'Agent <id> not found'}`.
- **Blocker:** B18.
- **Verified:** Static — [webhook-handler.ts:49-53](../../../server/connections/webhook-handler.ts#L49-L53).
- **Still needed:** Same as TC6B.31, plus a misconfigured webhook for an unmanaged agent.

### TC6B.33 — Webhook message extraction priority (live)
- **Spec:** `body.message` (string) → use; else `body.text` (string) → use; else `JSON.stringify(req.body)`.
- **Blocker:** B18.
- **Verified:** Static — [webhook-handler.ts:56-60](../../../server/connections/webhook-handler.ts#L56-L60).
- **Still needed:** Three live POSTs with each body shape, verifying the dispatched text via the resulting transcript.

### TC6B.34 — Cron schedule fires `dispatch` at tick (live)
- **Spec:** `cron.schedule('* * * * * *', tick)` fires within ~2s with `sessionKey: 'cron:<cronNodeId>'`, `text: prompt`. `lastRunAt` updates on the active job.
- **Blocker:** B18 — cron not in default palette.
- **Verified:** Static — [cron-scheduler.ts:91-118](../../../server/scheduling/cron-scheduler.ts#L91-L118).
- **Still needed:** REST/import path that injects a `crons: [{...}]` into a resolved `AgentConfig` plus a cron-aware coordinator lookup.

### TC6B.35 — Cron `maxRunDurationMs` aborts the run (live)
- **Spec:** With `maxRunDurationMs:50`, a longer dispatch is aborted ~50ms after start.
- **Blocker:** B18 + B13 (a long-running dispatch costs API).
- **Verified:** Static — [cron-scheduler.ts:110-114](../../../server/scheduling/cron-scheduler.ts#L110-L114).
- **Still needed:** Cron node + a scriptable long-running provider stub.

### TC6B.36 — Cron reconcile stops removed jobs (live)
- **Spec:** `reconcile([A,B])` then `reconcile([A])` → B's task `.stop()`; A unchanged.
- **Blocker:** B18.
- **Verified:** Static — [cron-scheduler.ts:30-71](../../../server/scheduling/cron-scheduler.ts#L30-L71).
- **Still needed:** Live cron config diff exercised through whatever REST/import path drives `reconcile`.

### TC6B.37 — Maintenance scheduler runs on start + interval (live)
- **Spec:** `MaintenanceScheduler.start()` calls `engine.runMaintenance()` once + every interval; `stop()` clears the timer; `runNow(mode)` invokes once with mode.
- **Blocker:** B18 — already invoked at backend boot but the per-interval tick wasn't observed (live run too short to span a 1-min interval); `runNow('warn'|'enforce')` exposed via `POST /api/storage/maintenance` was already exercised in §3 with the resolved `mode` argument.
- **Verified:** Static — [maintenance-scheduler.ts:12-23](../../../server/scheduling/maintenance-scheduler.ts#L12-L23). §3 confirmed `runNow` REST surface returns reports.
- **Still needed:** Boot-time + interval observation across ≥2 ticks (1-min interval); `runNow('warn')` and `runNow('enforce')` separately verified for mode forwarding.

## §7A — REST / WS / Auth / Storage / Sessions

### TC7A.6 — WS connection establishes + dispatch yields run events
- **Spec:** Send `agent:start` → `agent:ready` → `agent:dispatch` → streamed run events ending in turn-complete envelope.
- **Blocker:** B13 — full lifecycle requires a complete resolved `AgentConfig` and a real LLM dispatch (paying token cost). The connection + envelope layer was confirmed live (sending `{type:'agent:start', agentId}` without `config` returned a shaped `agent:error` envelope, proving the WS handler is processing commands).
- **Verified:** WS connection on `/ws` opens, receives well-formed JSON envelopes both directions; `agent:error` shape is correct.
- **Still needed:** A scripted full-config send + response capture, or a stub provider that fakes a stream so no API credits are spent.

### TC7A.7 — WS reconnect mid-stream
- **Spec:** Drop the socket mid-turn, reconnect, expect buffered events to be delivered.
- **Blocker:** B13 (long-running stream needed) + observation gap — the bridge has no replay buffer (re-confirmed in §6A, [event-bridge.ts:45](../../../server/agents/event-bridge.ts#L45)).
- **Verified:** Static — no replay path in source.
- **Still needed:** Either a stub provider with a forced long stream, or a documented user-acknowledged gap that reconnect mid-stream loses events. Either way the spec needs alignment with the actual code: there is no buffered replay today.

### TC7A.11 — Disk high-water eviction
- **Spec:** Multiple large transcripts > `maxDiskBytes`; maintenance evicts oldest until under high-water.
- **Blocker:** Building such a sandbox requires writing many MB of fake JSONL — possible but high friction. Skipped to keep the test footprint small after F-13 (the real maintenance bug) was found and prioritized.
- **Verified:** Static — [storage-engine.ts:400-403](../../../server/storage/storage-engine.ts#L400-L403) computes high-water bytes correctly and calls `enforceDiskBudget`.
- **Still needed:** Sandbox script that seeds N transcripts of known size, runs maintenance enforce on a *fresh* engine (per F-13 workaround), and asserts oldest-first eviction.

### TC7A.15 — Daily reset auto-trips on next route call
- **Spec:** Backdate session `updatedAt` to before today's `dailyResetHour`; call route → `reset:true`.
- **Blocker:** Engine in-memory `storeCache` (`readStore` at [storage-engine.ts:60-69](../../../server/storage/storage-engine.ts#L60-L69)) — out-of-band file edits don't invalidate the cache, so backdating `updatedAt` directly on disk is invisible until a server restart. The explicit `POST .../{sessionKey}/reset` route was exercised live and works.
- **Verified:** Explicit reset works; auto-reset code path at `session-router.ts` reads correctly.
- **Still needed:** Either restart the server between backdate and route call, or add a test-mode hook that invalidates the cache on demand, or seed the session via a real LLM turn followed by a 24h+ wait (impractical).

### TC7A.16 — Idle reset auto-trips after `idleResetMinutes`
- **Spec:** Same as TC7A.15 but for idle minutes.
- **Blocker:** Same as TC7A.15 — store cache.
- **Verified:** Explicit reset path works; `shouldReset` source reads correctly.
- **Still needed:** Same as TC7A.15.

## §7B — Tools / HITL / Skills / SAM CLI

### TC7B.3 — Memory tools save/recall round-trip
- **Spec:** "remember my dog's name is Rex" then "what's my dog's name?" → second turn calls memory recall and answers "Rex".
- **Blocker:** B13 — needs two real LLM dispatches.
- **Verified:** Memory engine tools themselves (`memory_save`, `memory_search`, `memory_get`) covered live in §6B (TC6B.6, TC6B.7).
- **Still needed:** A scripted dispatch (or stub provider) that exercises the model loop using the memory tools across two turns.

### TC7B.4 — Sessions yield surfaces transcript chunk
- **Spec:** "summarize the last 5 turns" → tool call with `sessions_history`, returns `entries[]` newest-first plus `truncated`/`nextCursor`.
- **Blocker:** B13.
- **Verified:** `sessions_history` tool surface + cap semantics covered statically in §6B's session-tools walkthrough.
- **Still needed:** Dispatch through a model.

### TC7B.5 — Tool name conflict (built-in vs user-tool)
- **Spec:** Install a user tool named `calculator` → `[tool-registry] user-installed tool "calculator" conflicts with...` warning, built-in still in catalog.
- **Blocker:** Registry only re-scans user-tool dirs at backend startup; live trip would require restarting the backend, which would tear down vite (per `sam restart` caveat).
- **Verified:** Conflict-warn line at [tool-registry.ts:285](../../../server/tools/tool-registry.ts#L285); fixture preparation confirmed manifest + module shape works end-to-end.
- **Still needed:** A standalone backend restart with the conflict fixture in place.

### TC7B.8 — Disabled user tool not loaded (live registry effect)
- **Spec:** `sam disable tool <name>` + restart → server log includes `skipping <dir>: disabled via sam.json`; `/api/tools` does not include the tool.
- **Blocker:** Same as TC7B.5 — registry re-scan needs restart.
- **Verified:** `sam disable` flips manifest correctly (live); skip-on-disabled line at [tool-registry.ts:161](../../../server/tools/tool-registry.ts#L161).
- **Still needed:** Restart-driven catalog diff.

### TC7B.11 — HITL approval (yes/no/maybe/abort)
- **Spec:** `confirm_action` pauses tool dispatch; "yes"/"no"/"maybe"/abort each map to specific outcomes.
- **Blocker:** B13.
- **Verified:** `parseConfirm` strict-yes/no semantics confirmed in spec text + §7A's `resolveForSession` walkthrough.
- **Still needed:** Real dispatch invoking `confirm_action`, then four WS reply variants.

### TC7B.16 — `sam install tool` from valid GitHub repo
- **Spec:** Clone-and-extract from a github URL, manifest synthesis, etc.
- **Blocker:** Network round-trip + leaving an installed dir behind on the user's machine.
- **Verified:** All URL-validation half exercised live (TC7B.17). `parseGithubUrl` tested with 4 invalid forms. Install body source-verified at `bin/commands/install.js`.
- **Still needed:** A dedicated test fixture repo on GitHub (small, stable, contains a single `*.module.ts` and optionally a `sam.json`) that can be installed-then-uninstalled without polluting any user state.

### TC7B.21 — `sam restart` Windows console flash
- **Spec:** Document-only — windows briefly flashes a console window during detached spawn.
- **Blocker:** Running `sam restart` would tear down vite (concurrently caveat).
- **Verified:** Source comment at [restart.js:95-104](../../../bin/commands/restart.js#L95-L104) explicitly acknowledges this.
- **Still needed:** Manual visual confirmation on a standalone Windows session.

### TC7B.22 — `sam restart` while `npm run dev` running
- **Spec:** Document caveat — vite drops because concurrently exits when one child dies.
- **Blocker:** Same tear-down concern.
- **Verified:** Source comment at [restart.js:21-24](../../../bin/commands/restart.js#L21-L24).
- **Still needed:** Manual reproduction (or wait for the source to add a CLI hint when it detects the parent process is `concurrently`).

### TC7B.23 / TC7B.24 — stale pid + boot timeout
- **Spec:** Force kill (no unlink) → "treating as stale, skipping kill". Boot failure → 20 s timeout + exit 1.
- **Blocker:** Both require killing the live server (which would lose vite).
- **Verified:** Stale-pid logic at [restart.js:65-68](../../../bin/commands/restart.js#L65-L68); boot-timeout logic at [restart.js:53-56](../../../bin/commands/restart.js#L53-L56).
- **Still needed:** Authorized backend restart cycle, ideally on a session that doesn't have vite running.

## What "fully covered" would require

To close every gap above, the next pass needs all of:

1. **A real human or true user-input automation** (Playwright with a live page, not synthetic events) for every B1/B2/B3/B6 case — these all hinge on browser pointer-event capture + CSS `:hover` matching that the chrome-devtools-mcp synthetic-event path doesn't satisfy.
2. **Visual-diff or screenshot-aware checks** for B4 / B6 / B12 — anything tied to the live drag image, the `SnapHighlight` overlay, or a streaming chat response needs frame-level inspection during the event.
3. **A test-mode build** (or a dev-only `window.__SAM_GRAPH_STORE` handle) to invoke the unreachable Zustand actions (B5: `applyPatch`, `clearGraph`) without their UI surface.
4. **A populated `providers.json`** (≥2 plugins) so TC2.25 / TC3.14 can fan through the multi-plugin path.
5. **A synced model catalog with deterministic metadata** so TC2.14's inherited variant can flip on demand (a fixture model whose `contextWindow` is known and verifiable).
6. **A safe fixture for the destructive paths** (TC1.9 destructive branches, TC2.11, TC3.27 sessions delete) — e.g., a dev backend that no-ops the storage delete and the Chrome launch so the click can be exercised without side effects.
7. **A test account with a partial OpenRouter `userModels` set** so TC3.10 filtering can be visually distinguished from "All".
8. **Authorized credential-mutation windows** (per-run reauth or a per-test ephemeral key) so TC3.9 / TC3.17 can clear-and-restore api keys for the duration of the assertion.
9. **Backend fault-injection hooks** (e.g., `?inject=500-on-settings-load`, scriptable shutdown) so TC3.28 / TC3.29 don't require physical backend stoppage during the suite.
10. **WebSocket-aware tooling** (raw browser DevTools, `chrome-devtools-protocol` Network domain with `Network.webSocketFrameReceived`, or Playwright with `page.on('websocket')`) so S4.2 / F-01 can be definitively re-classified.
11. **Replayable transcript fixtures** for S4.8 / S4.10–S4.12 / S4.20 (coloring crossover) / S4.22 / S4.28 / S4.29 — server fixtures that emit specific event sequences (tool error, HITL prompt, compaction, high-usage `context:usage`) without needing a real OpenRouter call.
12. **A scratch-graph fixture for destructive UI** (S4.18 agent deletion with chat open, S4.26 per-message delete, S4.30 SAM Agent clear) so the user's real graph + transcripts don't have to be touched.
13. **A Node-side resolver harness** so §5 tests that depend on `process.env` (T9) or Node's real `path.posix` (T24/T25) can be exercised without browser polyfill issues.
14. **A browser-safe replacement for `posixPath.posix.join`** in `src/utils/graph-to-agent.ts:138` (or import via `path-browserify`) so browser-side resolves don't crash when a user sets a working directory with sub-agents.
15. **An exposed singleton `agentClient` import path** (e.g. `window.__SAM_AGENT_CLIENT` in dev) so `evaluate_script` can drive WS commands like `agent:start` deterministically — closes B17 for §6B's REST channel scenarios without standing up a separate WS handshake.
16. **A graph fixture with a webhook config + a cron node** so the §6B scheduling and connection-handler scenarios (TC6B.31-37) get reachable code paths. Either expose webhook/cron in the default palette or ship a starter import.
17. **A test-mode hook to invalidate `storeCache`** in `StorageEngine` (or a `POST /api/storage/<key>/refresh-cache` dev-only endpoint) so TC7A.15 / TC7A.16 / parts of TC7A.9 can drive auto-reset / pruneStaleEntries without a server restart between backdating and the assertion call.
18. **A stub provider plugin** (or a route that fakes a streaming SSE response shaped like the real LLM stream) so TC7A.6 (full WS dispatch + run events), TC7A.7 (WS reconnect mid-stream), TC7A.17 parent-fork-with-tokens, TC7B.3, TC7B.4, TC7B.11, and the §6A 429 / timeout scenarios can run without burning real OpenRouter credits.
19. **A standalone backend restart path that doesn't take vite with it** — either a CLI flag on `sam restart` that respawns vite if it detects the concurrently parent, or documentation that `sam restart` should only be used from `npm run dev:server`. Closes the live half of TC7B.5, TC7B.8, TC7B.21-24.
20. **A small dedicated test fixture repo on GitHub** containing a minimal `*.module.ts` (and optionally a `sam.json`) so TC7B.16's full install-and-load cycle can be exercised without leaving install artifacts on user machines.
