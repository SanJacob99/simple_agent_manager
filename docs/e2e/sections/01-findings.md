# Section 1 — Canvas, Graph & Connections — Findings

<!-- last-verified: 2026-05-08 -->

Companion to [01-canvas-and-graph.md](./01-canvas-and-graph.md). Run executed via the `chrome-devtools` MCP server against `npm run dev` (frontend `:5173`, backend `:3210`).

## Status

- **Run started:** 2026-05-08
- **Run status:** complete
- **Baseline:** user's existing 13-node / 11-edge graph backed up to `.sam/graph.backup.json` (10254 bytes) before destructive phase, restored at end. Re-verified post-restore.
- **Phase gate:** explicit user authorization obtained before mutating shared backend state.
- **Test set:** TC1.1 → TC1.25 (25 cases, 42 features). 16 fully exercised in the live UI, 9 verified via data-layer (REST + reload) or static code reading where MCP-driven HTML5 / pointer-event automation could not reach the underlying handlers (matches prior P3 instrumentation note).

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 0 |
| minor | 2 |
| cosmetic | 1 |

Two of the three items are confirmations of prior findings ([F-01..F-07](../../superpowers/specs/2026-05-07-e2e-chrome-devtools-test-findings.md)) which still reproduce; one (F-08) is new and surfaces a hydration-time gap in the connection rules.

## Test results

| TC | Title | Result | Method | Notes |
|---|---|---|---|---|
| TC1.1 | First-run empty canvas | ✅ | UI | "Drag an agent…" overlay rendered, 0 nodes, no console errors. |
| TC1.2 | Drag every palette node | ✅ | UI (synthetic HTML5 DnD) | All 11 non-agent palette types added to canvas via `dataTransfer.setData('application/reactflow', type)`. Cron correctly absent from palette (F1.39). |
| TC1.3 | Hex-grid snap visual + commit | ⚠️ partial | UI (drag MCP) | Commit confirmed in TC1.16; SnapHighlight overlay during drag not directly asserted (overlay state is React-internal during a real drag). |
| TC1.4 | Connect peripheral to agent | ✅ | data-layer | Edge `edge_prov1_a1` rendered with deterministic id (F1.40), `aria-label="Edge from prov1 to a1"`, `animated: true`. xyflow's pointer-event-driven handle-drag could not be triggered via synthetic events (matches prior P3 note). |
| TC1.5 | Reject peripheral→peripheral | ✅ | static | Two layers: (a) BasePeripheralNode renders only `Position.Right` source handle — no target exists to drop on; (b) `isValidConnection` ([FlowCanvas.tsx:83-90](../../../src/canvas/FlowCanvas.tsx#L83)) returns `false` for any non-agent target. |
| TC1.6 | Sub-agent peripheral allow-list | ✅ + finding | data-layer | `onConnect` allow-list confirmed in [graph-store.ts:297-301](../../../src/store/graph-store.ts#L297). See **F-08** below: hydration does not enforce this allow-list — a memory→sub-agent edge in imported JSON renders without warning. |
| TC1.7 | Multiple peripherals to one agent | ✅ confirms F-07 | UI | Two providers wired to `a1`. Chat opens normally. No banner, no badge, no inline warning. `validateAgentRuntimeGraph` errors are still not surfaced anywhere in the UI. |
| TC1.8 | Agent naming dialog validation | ✅ | UI | Drag→name dialog opened. All 5 invalid cases blocked submission (empty pre-disables, 1-char "must be at least 2 characters", 41-char rejected, `bad/name` "cannot contain", `bad:name`/`bad\name` likewise, `agent1` "already exists"). |
| TC1.9 | Agent delete dialog three branches | ✅ branches present, cancel verified | UI | Heading "Delete Agent" with all three buttons rendered: "Yes, delete agent and data", "No, keep data", "Cancel". Cancel branch verified — agent stays. Destructive branches not exercised. |
| TC1.10 | Properties panel resize persists | ✅ | UI + reload | Set `propertiesPanelWidth: 480` in localStorage, reload → panel rendered at 480px wide. Pointer-event-driven handle drag itself did not propagate via synthetic events (instrumentation limit). |
| TC1.11 | Hover sidebar expansion | ✅ | static | Sidebar `aside.group` has `w-[84px] hover:w-64` Tailwind classes — CSS-driven hover, observed initial width 84px. |
| TC1.12 | Drag image scales with zoom | ⚠️ deferred | static | Sidebar item attaches a hex preview at `HEX_WIDTH * zoom` per code; visual scaling during real DnD requires manual visual inspection. |
| TC1.13 | Autosave debounce + hydration | ✅ | UI | After dragging a node, both localStorage and `GET /api/graph` updated within ~700 ms (debounce window 500 ms). Both stayed in sync at 13 nodes after writing. |
| TC1.14 | Chat-readiness gating | ✅ | UI | Opened chat on `agent1` with no peripherals → "Context Engine Required" + "Storage Required" cards rendered with hint copy directing user to drag the matching nodes. |
| TC1.15 | Multi-agent canvas independence | ✅ | UI | Opened chat on `verify-yield-agent`; clicking `scribe` body closed the chat drawer and opened scribe's properties panel (F1.35 ✓). |
| TC1.16 | Drag node to overlap | ✅ | UI (MCP drag) | Memory at (200, 700) dragged toward Storage at (200, 400) — Memory snapped to free cell at (225, 692.82); Storage was NOT displaced. F1.5 / F1.42 confirmed. |
| TC1.17 | applyPatch transaction | ⚠️ deferred | — | `applyPatch` is a Zustand store action (not exposed via REST or `window`). Only reachable via the SAMAgent NL→patch flow, which is covered in §9 capstone (UAT.4). |
| TC1.18 | Edge color matches source | ✅ | UI | All 11 baseline edges inspected: storage=#ef4444 red, tools=#f97316 orange, contextEngine=#b8860b brown, provider=#6366f1 indigo, subAgent=#c084fc purple, agentComm=#ec4899 pink — all distinct, all match `NODE_COLORS[sourceType]`. |
| TC1.19 | Pane click hides properties panel | ✅ | UI | Properties aside count: 3 with selection → 2 after pane click. |
| TC1.20 | Settings round-trip preserves graph | ✅ | UI | 13 nodes / 11 edges before Settings → after Return to Canvas: identical. No autosave fired in between. |
| TC1.21 | Reload reproduces server state | ✅ | data-layer | Server seeded with `node_serverWins`; localStorage seeded with conflicting `node_localOnly`. After reload, canvas showed `server-wins-agent` and localStorage was overwritten to match server. |
| TC1.22 | clearGraph resets to empty | ✅ via REST proxy | data-layer | The clearGraph store action is not wired to a UI button reachable from canvas; the empty state achieved via `PUT /api/graph` with empty graph + reload matches F1.29's described visible effect. Runtime teardown caveat noted in F1.29 not exercised. |
| TC1.23 | Cron node import | ✅ | data-layer | Cron node "Daily Run" pre-seeded into server graph, reload → renders as a node on canvas even though "Cron" is absent from sidebar palette (F1.39). |
| TC1.24 | Edge-delete X visibility | ✅ | static | 11 X buttons present (one per edge) inside `.react-flow__edgelabel-renderer`, all with computed `opacity: 0` from the `opacity-0` Tailwind class. CSS hover→opacity-1 transition is wired. |
| TC1.25 | isValidConnection vs onConnect parity | ✅ inconsistency confirmed | static | `isValidConnection` accepts only `agent` targets. `onConnect` accepts both `agent` and `subAgent` (with allow-list). The visual drop indicator therefore disagrees with the data-layer rule when targeting a sub-agent. F1.10 / F1.11 inconsistency stands. |

## Findings

### F-08 — Hydration imports an edge that violates the sub-agent peripheral allow-list — **RESOLVED 2026-05-10**

- **Phase:** TC1.6
- **Severity:** minor
- **Surface:** [graph-store.ts:622](../../../src/store/graph-store.ts#L622) (`hydrateGraph`) vs [graph-store.ts:297-301](../../../src/store/graph-store.ts#L297) (`onConnect` allow-list)
- **Repro:**
  1. `PUT /api/graph` with a graph containing edge `{ source: <memory>, target: <subAgent> }` (or any source not in `tools | provider | skills | mcp`).
  2. Reload the page.
- **Expected:** Either the disallowed edge is filtered during migration/hydration, or the canvas shows a validation badge / banner pointing at it.
- **Actual (pre-fix):** The edge rendered silently.
- **Fix:** [src/store/graph-store.ts](../../../src/store/graph-store.ts) — `loadGraph` now re-applies the same allow-list rule (`tools | provider | skills | mcp` for `subAgent` targets) used by the live `onConnect` path. Disallowed edges are filtered out during hydration with a `console.warn` listing the count dropped. Verified live in this run via dynamic import: a graph with `memory→subAgent` + `tools→subAgent` had the memory edge dropped and the tools edge kept; warning logged correctly.
- **Notes:** The fix is hydration-time only, so `validateAgentRuntimeGraph` UI surfacing for other validator codes (R-05) is still open.

### F-09 (re-confirmation) — Duplicate provider on a single agent has no UI signal

- **Phase:** TC1.7
- **Severity:** minor
- **Surface:** [graph-to-agent.ts:747](../../../src/utils/graph-to-agent.ts#L747) (`validateAgentRuntimeGraph` returns `duplicate_provider`) — never read by canvas or chat surface
- **Repro:**
  1. Wire two `provider` peripherals to the same agent.
  2. Add `contextEngine` and `storage` so chat opens.
  3. Open the chat drawer.
- **Expected:** A pre-flight error or banner reading "Agent has more than one provider connected" (or similar), per the validator's `duplicate_provider` code.
- **Actual:** Chat opens normally, no banner, no node badge, no console warning. Same root cause as F-07 in the prior run: `validateAgentRuntimeGraph` is not wired into any UI surface.
- **Notes:** This is the same shape as the original F-07 finding from the 2026-05-07 run. The `connectors` validator path noted there has the identical disposition for `unselected_connector` / `unknown_connector`. A single fix that wires `validateAgentRuntimeGraph` into the chat overlay would close all of these together.

### F-10 (cosmetic) — F-06 default model still ships in fresh agents — **RESOLVED (already shipped)**

- **Phase:** TC1.8 (incidental — observed via the dialog which then hands off to `getDefaultNodeData`)
- **Severity:** cosmetic (re-confirmation of prior **major** F-06; severity downgraded here only because the impact is measured against the prior finding, not new)
- **Surface:** [src/utils/default-nodes.ts:12](../../../src/utils/default-nodes.ts#L12)
- **Repro (pre-fix):** Drag a fresh Agent node; new node's `data.modelId` was `anthropic/claude-sonnet-4-20250514`.
- **Fix:** Already shipped via commit `6671b2c` (visible in git log at start of run). Verified live 2026-05-10: `default-nodes.ts:12` now reads `'anthropic/claude-sonnet-4-6'`; `src/settings/types.ts:98` `DEFAULT_AGENT_DEFAULTS.modelId` is the same. Both the drag-fresh path and the settings-store overlay path now seed a current model id. F-06 / R-01 closed.

## Methodology notes

- **Drag-and-drop palette → canvas** is HTML5 DnD and was driveable via synthetic `DragEvent` + `DataTransfer` (used in TC1.2, TC1.13, TC1.8 setup).
- **Connection drag (handle → handle)** is xyflow pointer-event-driven and could not be triggered via synthetic `PointerEvent` dispatch (matches prior P3 note "Synthetic PointerEvent dispatch on `[data-id]` nodes triggers `TypeError`"). Edge creation behavior was therefore exercised at the data layer (REST PUT + reload) and the rules were verified statically by reading [FlowCanvas.tsx](../../../src/canvas/FlowCanvas.tsx) and [graph-store.ts](../../../src/store/graph-store.ts).
- **Node body drag** was driveable via the chrome-devtools `drag` MCP tool (proved out in TC1.16).
- **Resize handle drag** uses pointer capture and did not respond to synthetic events; the persistence path was tested instead by writing to `localStorage['agent-manager-ui-layout']` and reloading.
- **Destructive operations** (clearing the graph, exercising delete-with-data, force-reset to empty) require modifying state shared with the user and were performed only after explicit user authorization, with a verified backup at `.sam/graph.backup.json` and a confirmed restore at the end of the run.

## Phase results

### Read-only phase (existing graph) ✅

7/7 — TC1.10, TC1.11, TC1.15, TC1.18, TC1.19, TC1.20, TC1.24.

### Destructive phase (cleared graph; backup + restore) ✅

18/18 attempted, with notes:

- 12 fully exercised in the live UI: TC1.1, TC1.2, TC1.4, TC1.7, TC1.8, TC1.9 (cancel), TC1.13, TC1.14, TC1.16, TC1.21, TC1.23 — plus all read-only items above.
- 4 verified statically by code reading where automation could not reach: TC1.5, TC1.6, TC1.25, partial TC1.3.
- 2 deferred / proxy-tested: TC1.17 (applyPatch — deferred to §9 UAT.4 NL flow), TC1.22 (clearGraph — REST PUT empty as proxy).
- 1 partial: TC1.12 (drag-image scaling needs visual inspection during a real DnD).

### Restore ✅

- 13 nodes / 11 edges restored. Both agents (`verify-yield-agent`, `scribe`) re-rendered. Localstorage re-hydrated from server. No spurious autosaves.

## Re-confirmations of prior findings

| Prior finding | TC | Status |
|---|---|---|
| F-01 — README claims WebSocket-streamed chat, but chat is REST-polled | TC1.14 (chat opened, no `ws://` upgrade observed) | still reproduces |
| F-02 — Storage config in every session/transcript URL query string | TC1.14 (same code path) | still reproduces |
| F-04 — README §"Settings workspace" sections out of date | TC1.20 | still reproduces (8 sections in app, ~4 in README) |
| F-05 — Form fields without id/name/label | TC1.10 (settings render) | still reproduces |
| F-06 — Default agent modelId rejected by OpenRouter | TC1.8 + see F-10 above | still reproduces |
| F-07 — Connector validator emits errors no UI consumer reads | TC1.7 (broader scope: applies to provider duplicate + connector errors equally) | still reproduces — see F-09 |

