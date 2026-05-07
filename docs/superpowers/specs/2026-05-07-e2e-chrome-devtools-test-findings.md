# E2E Chrome DevTools Test — Findings

<!-- last-verified: 2026-05-07 -->

Companion to [2026-05-07-e2e-chrome-devtools-test-design.md](./2026-05-07-e2e-chrome-devtools-test-design.md).

## Status

- **Run started:** 2026-05-07
- **Run status:** in progress (P4 complete, awaiting final summary)
- **Phase gate:** stop after each phase for user summary before continuing

## Summary

| Severity | Count |
|---|---|
| blocker | 0 |
| major | 1 |
| minor | 3 |
| cosmetic | 3 |

## Findings

### F-01 — README claims WebSocket-streamed chat, but chat is REST-polled

- **Phase:** P2
- **Severity:** minor
- **Surface:** Chat drawer / `server/runtime/agent-runtime.ts` + `src/chat/useChatStream.ts`
- **Repro:** Open chat on any agent. Send a message. Inspect network requests filtered by `websocket` resource type, or `performance.getEntriesByType('resource').filter(e => e.name.startsWith('ws'))`.
- **Expected:** A `ws://localhost:3210/...` upgrade — README states "streamed chat over WebSockets" and the architecture overview lists "Express + WebSocket backend".
- **Actual:** No WebSocket connection. The frontend POSTs to `/api/sessions/.../route` and then polls `GET /api/sessions/.../transcript` and `GET /api/sessions/.../{sessionId}` repeatedly until the run completes.
- **Notes:** Either README is out-of-date or WebSocket streaming was removed/regressed. The polling design also raises the storage-config-in-query-string concern in F-02.

### F-02 — Storage config serialized into every session/transcript URL query string

- **Phase:** P2
- **Severity:** minor
- **Surface:** `src/runtime/storage-client.ts` and any caller of `/api/sessions/{nodeId}/...`
- **Repro:** Open chat on any agent. Inspect any `GET /api/sessions/.../...` request URL.
- **Expected:** Config sent once (e.g., on storage init) or in a request body. URLs short and stable.
- **Actual:** Each request URL is ~700+ chars, e.g. `?config=%7B%22label%22%3A%22Storage%22%2C%22backendType%22%3A%22filesystem%22%2C%22storagePath%22%3A%22~%2F.simple-agent-manager%2Fstorage%22%2C%22sessionRetention%22%3A50%2C%22memoryEnabled%22%3Atrue%2C%22dailyMemoryEnabled%22%3Atrue%2C%22dailyResetEnabled%22%3Afalse%2C%22dailyResetHour%22%3A4%2C%22idleResetEnabled%22%3Afalse%2C%22idleResetMinutes%22%3A60%2C%22parentForkMaxTokens%22%3A100000%2C%22maintenanceMode%22%3A%22warn%22%2C%22pruneAfterDays%22%3A30%2C%22maxEntries%22%3A500%2C%22rotateBytes%22%3A10485760%2C%22resetArchiveRetentionDays%22%3A30%2C%22maxDiskBytes%22%3A0%2C%22highWaterPercent%22%3A80%2C%22maintenanceIntervalMinutes%22%3A60%7D&agentName=scribe`.
- **Notes:** Risks: (a) hits 2KB+ URL caps in some proxies/CDNs as config grows, (b) dumps full storage config (including paths) into HTTP access logs, (c) wastes bandwidth on the polling loop. Hash-based or POST-body approach would scale better.

### F-03 — Stale `anthropic/claude-sonnet-4-20250514` model ID error preserved in scribe's transcript

- **Phase:** P2 (incidental finding)
- **Severity:** cosmetic
- **Surface:** Chat drawer, `scribe` agent, default `Main` session
- **Repro:** Open chat on `scribe` → Main session. Scroll history.
- **Expected:** Either historical error messages are clearly time-stamped/dated, or stale errors from prior model configurations are pruned/hidden after the agent is reconfigured.
- **Actual:** A historical error reads `"The provider (openrouter) returned an error for anthropic/claude-sonnet-4-20250514: anthropic/claude-sonnet-4-20250514 is not a valid model ID"` even though the agent is now configured to `anthropic/claude-haiku-4.5`. To a returning user this looks like a current failure.
- **Notes:** Not reproducing it now — it's preserved from a prior session. But it surfaces a UX question: should the chat UI flag this as historical or strike it through? Low priority.

### F-04 — README documents 4 settings sections; app has 8

- **Phase:** P1 (incidental finding)
- **Severity:** cosmetic
- **Surface:** [README.md](../../../README.md) §"Settings workspace"
- **Repro:** Compare README list (Providers & API Keys, Model Catalog, Defaults, Data & Maintenance) with sidebar in Settings UI (Providers & API Keys, Model Catalog, Defaults, SAMAgent, Safety, Appearance, Colors, Data & Maintenance).
- **Expected:** README mentions all 8 sections.
- **Actual:** README missing SAMAgent, Safety, Appearance, Colors.
- **Notes:** Pure docs drift. README probably predates SAMAgent settings, theme work, and safety controls.

## Phase results

### P1 — Smoke ✅

All 6 checks passed. Backend health 200, frontend renders, no console errors, no 4xx/5xx network requests on load (162 requests), 12 draggable palette items confirmed, Settings opens with 8 sections.

### P2 — Critical happy path ✅

Used existing `scribe` agent (Provider/Storage/ContextEngine connected) instead of building from scratch to avoid clobbering the user's pre-existing graph. Created a fresh session `Session 1 · 04:48 PM`, sent `"Reply with exactly the word 'pong'."`, received `pong` (5 tokens out, 2.7K in) within ~3s. No console errors. Transcript persisted across full page reload.

### P3 — Surface sweep ✅

**Settings sections (8/8 render):** Providers & API Keys (13 providers), Model Catalog, Defaults, SAMAgent, Safety, Appearance, Colors, Data & Maintenance. None blank, no errors.

**Property editors (13/13 render):** Verified by selecting each node type. Missing-from-canvas types (memory, skills, connectors, vectorDatabase, mcp, cron) added via synthetic drag-drop with `application/reactflow` data, then deleted post-test. Connectors catalog has 1 entry (GitHub) per design.

**Graph operations:** `Export Graph` produced `agent-graph-1778187425435.json` blob (read-only verified). Import not exercised via MCP (file picker). Multi-agent canvas (3 agents) was already loaded.

**OpenRouter sync:** `POST /api/providers/catalog/refresh` → 200 in 288ms.

### F-05 — Accessibility: many form fields lack id/name and labels

- **Phase:** P3
- **Severity:** cosmetic
- **Surface:** Multiple — Settings provider key inputs and node property editors
- **Repro:** Open DevTools issues panel after navigating Settings + clicking through several node types.
- **Expected:** Each form field should have an `id`, `name`, or programmatically-associated `<label>`.
- **Actual:** Chrome reports `A form field element should have an id or name attribute (count: 156)` and `No label associated with a form field (count: 86)`.
- **Notes:** Doesn't break functionality, but assistive tech and password managers won't work well. Likely pattern: shared.tsx label/input wrappers don't always wire `htmlFor` ↔ `id`. Low priority but worth a sweep if accessibility is in scope.

### Test-instrumentation note (not a finding)

Synthetic `PointerEvent` dispatch on `[data-id]` nodes triggers `TypeError: Cannot read properties of null (reading 'document')` in `@xyflow/react`'s `nodrag_default` handler (file `@xyflow_react.js:972`). Root cause: dispatched events lack the proper target/owner that real user clicks have. The error is a side effect of automation, not reachable by real user interaction. Documented here so a future test author doesn't chase it.

### F-06 — Default agent model `anthropic/claude-sonnet-4-20250514` is rejected by OpenRouter

- **Phase:** P4
- **Severity:** **major**
- **Surface:** [src/utils/default-nodes.ts:12](../../../src/utils/default-nodes.ts#L12), [src/settings/types.ts:98](../../../src/settings/types.ts#L98)
- **Repro:** Drag a fresh Agent node onto the canvas (no other config). Open its property panel. The Model field is pre-filled with `anthropic/claude-sonnet-4-20250514`. Connect the agent to a Provider (OpenRouter), Storage, and Context Engine. Open chat and send any prompt.
- **Expected:** Default model is a currently-valid model ID for the default provider, OR an empty value that forces the user to pick.
- **Actual:** Provider returns `anthropic/claude-sonnet-4-20250514 is not a valid model ID`. Confirmed live in P2 — the historical error in `scribe`'s Main session (originally logged as F-03) is reproducible because the default still ships this model. This is the root cause of F-03; F-03 was the visible symptom.
- **Notes:**
  - The default appears in 30+ places across the codebase (tests, fixtures, plans, docs). Some are fixture/test snapshots and only the runtime defaults need fixing — but every new agent created today will fail to chat until the user manually changes the model.
  - Suggested fix: pick the latest available Anthropic Sonnet ID at the time, or fall back to the user's `agentDefaults.modelId` from settings (which still has the same stale default — see `src/settings/types.ts:98`).
  - Today is 2026-05-07; `claude-sonnet-4-20250514` was the May 2024 release, ~2 years stale.

### F-07 — Connector validator emits errors that no UI consumer reads

- **Phase:** P4
- **Severity:** minor
- **Surface:** [src/utils/graph-to-agent.ts:747](../../../src/utils/graph-to-agent.ts#L747) (`validateAgentRuntimeGraph`)
- **Repro:**
  1. Drop a Connector node onto the canvas.
  2. Connect it to an existing Agent.
  3. Leave `connectorId` empty (the default).
  4. Open the chat drawer for the agent and try to chat.
- **Expected:** Per the recent commit `dbf3d00 feat(connectors): validator surfaces unselected/unknown connectorId`, the user should see a clear "Connector node "X" has no connector selected" warning somewhere — node badge, property panel, chat banner, or pre-flight error.
- **Actual:** The validator function returns `unselected_connector` / `unknown_connector` errors as designed, with passing unit tests, but **no UI code calls `validateAgentRuntimeGraph`**. Searching the codebase: only references are inside `graph-to-agent.ts` itself, its tests, and documentation. No node badge, no property-panel warning, no banner. The errors are never shown to the user.
- **Notes:**
  - The connector itself is silently skipped during config resolution (per the comment in `graph-to-agent.ts:409`), so the agent runs without the connector but doesn't tell the user why.
  - Fix: wire `validateAgentRuntimeGraph` into the chat drawer's pre-send check, or display its output in a dedicated validation banner / inline node badges.

### P4 — Edge cases ✅ (partial)

| Test | Result |
|---|---|
| Agent without Context Engine/Storage | UI gracefully omits "Open Chat" button on the agent node — but property panel surfaces no hint about what's missing. New users may be confused. (Not logged as a finding because the chat-blocked behavior in the README explicitly describes this; missing-message UX is borderline.) |
| Connector with no `connectorId` | F-07: validator runs but UI never displays output |
| Connector with unknown `connectorId` | Same as above (same validator path) |
| Cron runtime | Skipped — would actually trigger schedules |
| Vector Database runtime | Skipped — heavy backend setup |
| Agent Comm runtime | Existing user graph already has working channels (`to-verify`, `to-scribe`); no anomalies in property editor |
| Placeholder tool execution | Skipped — would mutate the user's `scribe` agent and risks breaking P2 reproducibility |
| Storage maintenance non-destructive ops | No "run maintenance" button reachable without modifying retention/destructive settings |
| Retention configuration | Visible in Storage property editor (Session Retention input); not exercised |
