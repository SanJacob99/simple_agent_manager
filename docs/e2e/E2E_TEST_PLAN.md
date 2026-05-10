# Simple Agent Manager — End-to-End Test Plan

<!-- last-verified: 2026-05-08 -->

This document is a **complete catalog of the user-facing and integration behavior of Simple Agent Manager** as it exists in the source tree today. It is intended to feed an external E2E test design / QA pass.

It is organized as one master plan plus nine **section files** under [`sections/`](./sections/), each scoped to one part of the system. Sections were authored by independent code-reading passes and contain feature lists, file:line references, and per-section test scenarios. **The master plan owns**: traceability, cross-cutting flows that span sections, prioritization, and the consolidated risk register.

---

## 0. How to use this document

1. **Skim §1 and §2** for app context and the architectural map.
2. **Pick a coverage strategy** in §3 (smoke → critical happy path → surface sweep → cross-cutting → edge cases → capstone).
3. **Drill into the section files** for per-feature catalogs and per-section scenarios.
4. **Use §6** to bake in the already-known issues so they are explicit pass/fail conditions in the test pass, not surprises.
5. **Treat §5 (cross-cutting flows) as MUST-PASS**: these are the data flows that exercise multiple subsystems in one trace.
6. **Treat §9 (Capstone UATs) as the acceptance bar**: UAT.10 is the binary win condition — replicating the multi-agent content pipeline from the reference image end-to-end.

The section files are the source of truth for feature-level details. The master plan does not re-list every feature — it indexes them.

---

## 1. App context

Simple Agent Manager is a node-based visual AI agent builder.

- **Stack**: React 19 + TypeScript + `@xyflow/react` (graph editor), Zustand (state), Vite (dev server) on the frontend; Express + `ws` (WebSocket) on the backend; `@mariozechner/pi-agent-core` for provider streaming.
- **Architecture split** (see `CLAUDE.md`):
  - `src/` — React UI: canvas, palette, chat drawer, property editors, settings workspace, browser-side stores and clients.
  - `shared/` — serializable `AgentConfig`, system prompt assembly, tool resolution, token estimation, protocol/run/storage types.
  - `server/` — Express + WS, agent manager, run coordinator, runtime engines, storage and session routing, hooks, transcript persistence.
- **Local entrypoints**: Vite frontend on `http://localhost:5173`; backend on `http://localhost:3210`. `npm run dev` runs both. `npm run dev:server` runs the backend alone.
- **Operator CLI**: `sam` (under `bin/`) for tool install/uninstall/enable/disable/list, server diagnose/restart.
- **Persistence**: graphs and per-agent session transcripts live on disk under `~/.simple-agent-manager/storage/` by default; provider keys live in browser `localStorage`.

### High-level flow

```
[Canvas graph]
     |
     v
graph-store (Zustand)
     |
     v
graph-to-agent.ts ─ resolveAgentConfig() ─> AgentConfig (shared/agent-config.ts)
     |
     v
agentClient over WS  ─────────────►   server/connections/ws-handler
     |                                          |
     v                                          v
session list / transcript  <──── REST ────► run-coordinator → agent-manager
                                                |
                                                v
                                          runtime-factory → agent-runtime
                                                |
                                                v
                                          provider stream → stream-processor → stream-transforms
                                                |
                                                v
                                          event-bridge → WS broadcast → useChatStream → ChatMessages
```

Two transports coexist in the running app — **WS** for live run events, **REST** for session list / transcript hydration / flush. (Prior finding `F-01` claimed WS was missing; §4 and §7A re-verified that WS is wired and used; only the README copy was misleading.)

---

## 2. Section index

| § | File | Scope | Approx. features | Approx. scenarios |
|---|---|---|---|---|
| 1 | [01-canvas-and-graph.md](./sections/01-canvas-and-graph.md) | Canvas, graph editor, palette, edges, connection rules, multi-agent layout | 42 | 25 |
| 2 | [02-property-editors.md](./sections/02-property-editors.md) | Properties Panel + per-node-type editors (13 editors, ~135 fields) | ~135 fields across 13 editors | 25 |
| 3 | [03-settings-workspace.md](./sections/03-settings-workspace.md) | Settings workspace (Providers, Model Catalog, Defaults, SAMAgent, Safety, Appearance, Colors, Data & Maintenance) | ~50 | 30 |
| 4 | [04-chat-and-sessions.md](./sections/04-chat-and-sessions.md) | Chat drawer, streaming, sessions, peer channels, HITL banner, in-app SAM Agent | 30 | 30 |
| 5 | [05-shared-resolution.md](./sections/05-shared-resolution.md) | Graph → AgentConfig resolution, system prompt assembly, tool name resolution, token estimation, protocol/run/storage types | 20 resolution rules + many | 48 |
| 6A | [06a-runtime-coordination.md](./sections/06a-runtime-coordination.md) | Agent manager, run coordinator, runtime factory, agent-runtime loop, model resolver, stream processor + transforms, event bridge | 12 components | 20 |
| 6B | [06b-engines-hooks-comms.md](./sections/06b-engines-hooks-comms.md) | Context engine, memory engine, hooks, sub-agents, agent-comm bus, cron scheduler, webhooks | many | 37 |
| 7A | [07a-api-storage-sessions.md](./sections/07a-api-storage-sessions.md) | REST route inventory, WS server, auth posture, storage engine, session router, transcript store | exhaustive route table | 22 |
| 7B | [07b-tools-hitl-cli.md](./sections/07b-tools-hitl-cli.md) | Tool factory/adapter/registry, built-in tools, MCP, user tools, tool redaction, HITL queue, server-side SAM Agent, SAM CLI | 21 built-in modules + 7 session tools + CLI | 26 |

Ballpark totals: **~280 distinct features** and **~263 per-section scenarios**, before cross-cutting flows in §7.

---

## 3. Recommended phased approach (smoke → depth → cross-cutting → edge)

This mirrors and extends the prior phased approach in [`docs/superpowers/specs/2026-05-07-e2e-chrome-devtools-test-design.md`](../superpowers/specs/2026-05-07-e2e-chrome-devtools-test-design.md). That doc was a one-shot Chrome-DevTools-driven run. This plan is broader and is what an external QA team should execute.

### P1 — Smoke (~5 min, blocking gate)

| Check | Section refs | Pass criteria |
|---|---|---|
| Backend health: `GET /api/health` 2xx | §7A TC7A.1 | 200 + JSON body |
| App shell loads at `/` | §1 + §3 | No uncaught exceptions, no 4xx/5xx network |
| Settings opens with 8 sections | §3 | All 8 listed (Providers, Model Catalog, Defaults, SAMAgent, Safety, Appearance, Colors, Data & Maintenance) |
| Sidebar palette draggable items present | §1 | Default 9 + Provider variants visible |
| Drag a node onto the canvas | §1 | Node appears, selectable, property editor renders |
| WS connection established on chat open | §4 + §7A | `ws://localhost:3210/ws` upgrade in network tab |

### P2 — Critical happy path (~15 min, blocking gate)

The smallest agent that can chat:

1. Settings → Providers & API Keys: enter a working key for one provider (default OpenRouter).
2. Drop `Agent`, `Provider`, `Storage`, `Context Engine` onto the canvas.
3. Wire `Provider`, `Storage`, `Context Engine` → `Agent`.
4. Open the Agent property editor; set/confirm `modelId` to a **valid current model id** (note default per §6: `anthropic/claude-sonnet-4-20250514` is stale and will fail — see prior finding `F-06`; §6 below).
5. Open chat from the agent node; send `"Reply with exactly the word 'pong'."`.
6. Verify: stream renders, "pong" returned, no console errors, transcript persists across full page reload.
7. Backend log shows: WS connect → `agent:start` → `run:accepted` → run lifecycle events → completion.

Sections that own each step: §1 (drag/connect), §2 (editor), §5 (resolved config), §6A (run pipeline), §7A (transport + transcript), §4 (UI render).

### P3 — Surface sweep (~60 min)

For each item below, exercise the per-section scenarios in the corresponding section file.

- **§1 Canvas**: TC1.1–1.25 — every node type drag, every connection rule, deletion flows, multi-agent layout.
- **§2 Property editors**: TC2.1–2.25 — open every editor, change every visible field, confirm persistence.
- **§3 Settings workspace**: TC3.1–3.30 — every section, save/dirty/swallow paths, model catalog refresh, defaults propagation.
- **§4 Chat**: TC4.1–4.30 — markdown rendering, tool call expand, thinking, peer channels, HITL approve/deny, image+audio attachments, transcript hydration.
- **§5 Resolution**: TC5.1–5.48 — graph→config invariants, prompt assembly order, tool name resolution, validator codes.
- **§6A Runtime**: TC6A.1–6A.20 — queueing, abort, error mapping, stream-transform pipeline, model resolver fallbacks.
- **§6B Engines**: TC6B.1–6B.37 — context budget, memory tools, hooks tier 1 firing, sub-agent fork/depth, comms turn/depth/rate/token limits, webhook, cron.
- **§7A API**: TC7A.1–7A.22 — full route inventory, WS reconnect, storage maintenance modes, transcripts JSONL.
- **§7B Tools/HITL/CLI**: TC7B.1–7B.26 — every built-in, MCP, user-tools precedence, redaction, HITL approve/deny/timeout, every `sam` command.

### P4 — Cross-cutting flows (see §7)

These are MUST-PASS because they exercise multiple subsystems in one trace.

### P5 — Edge cases, in-progress surfaces, regressions

See §6 (consolidated risk register) and the per-section "Open Questions" / "Known Gaps" callouts.

### P6 — Capstone UATs (acceptance gate)

See §9. Run UAT.1 → UAT.9 in order; failures here block UAT.10. UAT.10 is the binary win condition.

---

## 4. Cross-cutting traceability map

When a single user action traverses multiple sections, this table tells you which scenarios to run together to detect a regression.

| User action | Frontend | Resolution | Server runtime | Server surface | UI render |
|---|---|---|---|---|---|
| Drag node → fill editor → save | §1 F1.1–1.5 | §5 rule R1–R5 | — | §7A graph save | §1 persistence |
| Open chat from agent node | §1 + §4 F4.1 | §5 prompt build | §6A runtime-factory | §7A WS upgrade + session bootstrap | §4 F4.4 transcript hydrate |
| Send message → "pong" | §4 F4.1 | §5 + §6A resolve-system-prompt | §6A run-coordinator → agent-runtime → stream-processor → event-bridge | §7A WS event broadcast | §4 F4.2 streaming render |
| Tool call (calculator) | §2 ToolsNode | §5 tool resolution | §6A tool dispatch | §7B tool-factory + adapter + builtin/calculator | §4 F4.11 tool-call render |
| Tool call requiring HITL approval | §3 Safety | §5 + §6A | §6A pause path | §7B HITL registry | §4 F4.6 HitlBanner + approve |
| Memory save/recall | §2 MemoryNode + agent | §5 memory tools | §6B memory-engine | §7B session-tools | §4 transcript reflects |
| Sub-agent spawn | §1 SubAgentNode + connect | §5 sub-agent resolution | §6A + §6B sub-agent-executor | §7B session-tools.spawn | §4 nested transcript |
| Agent comm A → B | §1 connect via AgentCommNode | §5 channel config | §6B agent-comm-bus | §7A `routes/agent-channels.ts` + WS | §4 PeerChannelsSection |
| Compaction at budget | §2 ContextEngineNode | §5 budget | §6B context-engine + §6A compaction-handler stream-transform | §7A transcript rewrite | §4 F4.5 ContextUsagePanel |
| Provider key entry | §3 Providers section | — | §6A model-resolver lookup | §7A `/api/settings` + `auth/api-keys` cache | §3 masked input |
| Model catalog refresh | §3 Model Catalog | shared/model-catalog.ts | — | §7A `POST /api/providers/catalog/refresh` | §3 list updates |
| Storage maintenance prune | §3 Data & Maintenance | — | — | §7A `storage-engine` + `session-router` | §3 maintenance report |
| Graph export / import | §3 Data & Maintenance | shared serialization | — | §7A `/api/graph` (or local file pick) | §1 graph rebuilt |
| `sam install tool` | — | shared `user-tool-manifest.ts` | — | §7B CLI + tool-registry restart | requires server restart |
| `sam restart` | — | — | §6A runtime-state reset | §7B CLI + §7A startup | F4 reconnects |

---

## 5. Suggested cross-cutting test scenarios (must-pass)

Beyond per-section scenarios, the following multi-section scenarios are highest-value because each exercises five-plus subsystems in one trace.

### CC.1 — Cold start: fresh app → first chat → reload

Covers §3 (key entry) + §1 (graph build) + §2 (editor) + §5 (resolution) + §6A (run) + §7A (WS + transcript) + §4 (render).

1. Clear browser state. Launch `npm run dev`.
2. Settings → enter OpenRouter key.
3. Settings → Defaults → set a valid current model id (workaround for stale default, see §6 risk R-01).
4. Drag Agent + Provider + Storage + ContextEngine; wire all peripherals → Agent.
5. Open chat. Send "ping".
6. Verify reply, no console errors, no 4xx/5xx.
7. Hard reload. Reopen agent's chat. Last message must reload from transcript.

### CC.2 — Provider failure path

Covers §6A `model-resolver` + §6A `classifyError` + §4 error rendering + prior finding `F-06`.

1. Set `modelId` to an obviously-invalid string (e.g. `nope/nope-1`).
2. Send a message.
3. Verify a clean, single error message renders inline (no double error, no retry storm). Transcript persists the error event.

### CC.3 — Tool call with HITL approval round trip

Covers §3 Safety policy + §2 ToolsNode + §6A dispatch path + §7B HITL queue + §4 HitlBanner.

1. Settings → Safety → set HITL policy to require approval for all tool calls.
2. Build agent that has `calculator` tool enabled (§2).
3. Ask the agent to compute something.
4. Banner appears. Approve.
5. Tool runs, result streams. Repeat with deny path; verify model receives a denial result and continues.

### CC.4 — Sub-agent spawn

Covers §1 SubAgentNode + §5 sub-agent config + §6A executor + §6B registry + §7B session-tools.spawn.

1. Add a parent Agent and a Sub-Agent node referencing a second Agent.
2. Parent system prompt: "When asked, delegate to your sub-agent."
3. Send a request that should delegate.
4. Verify nested transcript shows parent → sub call → sub completion → parent resumes.
5. Re-run with depth limit set to 1 and a recursive prompt; verify depth block.

### CC.5 — Agent-to-agent comms with limits

Covers §1 connect + §2 AgentCommNode + §6B agent-comm-bus + §7A `routes/agent-channels.ts` + §4 PeerChannelsSection.

1. Two agents A and B with shared channel.
2. Set turn limit = 4.
3. Trigger A → B → A → B → would-be-fifth.
4. Verify channel seals at the limit; both sides see the seal event.
5. Re-run with token limit; trigger long messages; verify token-budget seal.
6. Re-run with rate limit; trigger burst; verify rate-limit reject.

### CC.6 — Context-budget compaction

Covers §2 ContextEngineNode + §6B context-engine + §6A compaction-handler stream transform + §4 ContextUsagePanel.

1. Set context budget low enough that 6–8 messages exceed it.
2. Send messages until compaction fires.
3. Verify ContextUsagePanel shows the drop, transcript still renders coherently, prompt was rebuilt.

### CC.7 — Storage maintenance dry-run + prune

Covers §3 Data & Maintenance + §7A `storage-engine` + §6B `session-router` cleanup.

1. Configure short retention/prune.
2. Generate enough sessions to exceed `maxEntries` or `maxDiskBytes`.
3. Run maintenance dry-run; verify report identifies prune candidates and orphans.
4. Run real maintenance; verify deletes and rotation.
5. Verify no live session is killed.

### CC.8 — `sam install tool` end-to-end

Covers §7B CLI + §7B tool-registry + §6A tool dispatch + §4 tool render.

1. `sam install tool <github-url>` against a known good repo.
2. `sam restart`.
3. Build an agent with the new tool enabled.
4. Trigger the tool from chat; verify it runs.
5. `sam disable tool <name>`. Restart. Verify server log "skipping ... disabled via sam.json" and tool no longer dispatches.
6. `sam uninstall tool <name>`. Verify directory removed.

### CC.9 — WS reconnect mid-run

Covers §4 useChatStream + §7A WS server + §6A event-bridge.

1. Send a long-running prompt.
2. Mid-stream, briefly drop network (devtools offline ~3s).
3. Reconnect.
4. **Note risk R-04**: §6A reports event-bridge has no replay buffer; events emitted while disconnected may be lost. Verify whether transcript flush via REST polls fills the gap. This scenario doubles as a regression detector for that risk.

### CC.10 — Backend independence (REST control without UI)

Covers §7A routes + per memory-feedback "control paths must work via REST, not only via WebSocket; backend runs without the frontend."

1. With backend running and frontend not connected:
   - `POST /api/providers/catalog/refresh` succeeds.
   - `POST /api/sessions/{nodeId}/route` starts a run (with a pre-known nodeId).
   - `GET /api/sessions/{nodeId}/transcript` returns transcript JSONL.
2. Open frontend after the run completed; transcript hydrates.

### CC.11 — Two agents on canvas, run concurrency

Covers §1 + §6A `RunConcurrencyController` + risk R-02.

1. Two agents A and B. Open chat for each.
2. Send a long prompt to A.
3. Immediately send a prompt to B.
4. **Risk R-02**: §6A reports that `RunConcurrencyController.activeRunId` is a single field — runs are serialized **process-globally**, not per-agent. Verify whether B is queued behind A or runs in parallel. Either way, document the actual behavior and confirm UI never deadlocks.

### CC.12 — Connector with no `connectorId`

Covers §1 ConnectorsNode + §5 validator + prior finding `F-07`.

1. Drop a Connector node, leave connectorId empty, connect to an agent.
2. Send a chat message.
3. Verify behavior. **F-07**: `validateAgentRuntimeGraph` emits an error but no UI surface reads it; the connector is silently skipped. Confirm whether this regression has been fixed; if not, log it again.

---

## 6. Consolidated risk register

This is the **single biggest reason this document exists**: capturing risks that section-level testing alone may miss. Each risk maps back to the section that surfaced it. Treat each risk as a target for a dedicated test scenario.

| ID | Risk | First surfaced in | Severity (proposed) | Test scenario reference |
|---|---|---|---|---|
| R-01 | Default `modelId` literal `anthropic/claude-sonnet-4-20250514` (in `src/utils/default-nodes.ts` and `src/settings/types.ts`) is stale → every fresh agent fails to chat until manually changed. Repeats prior finding **F-06**. | §2, §5 | major | CC.1 step 3, §2 TC2.x default model, §6A TC6A.6 |
| R-02 | `RunConcurrencyController` has a single `activeRunId` — runs are serialized globally across all agents, not per-agent. Multi-agent concurrency claim in this plan and CLAUDE.md may not hold. | §6A | major | CC.11 |
| R-03 | `AgentManager.restoreFromDisk()` is exported but **never called** in `server/index.ts` — agents are not auto-restored on `sam restart`; they re-instantiate only when a client opens chat. | §6A | major | After `sam restart`, query agent state via REST without opening chat; expected vs actual |
| R-04 | `EventBridge` has no replay buffer or queue. Reconnecting clients lose events emitted while disconnected. | §6A | major | CC.9 |
| R-05 | `validateAgentRuntimeGraph` emits validator errors that **no UI consumer reads** (repeats prior finding **F-07**). Connector with empty/unknown id silently degrades. | §1, §2, §5 | minor | CC.12, §1 TC1.x validator, §5 validator scenarios |
| R-06 | Per-request session URLs serialize the entire `ResolvedStorageConfig` (~16 fields including paths and quotas) into the `?config=` query string. Risk: 2KB+ URL caps in proxies, leak of paths into access logs, bandwidth on polling loop. (Repeats prior finding **F-02**.) | §4, §7A | minor | §7A TC7A.5 |
| R-07 | `GraphFileStore.save` and `SettingsFileStore.save` use plain `fs.writeFile` (no temp+rename) → crash mid-write or concurrent saves can corrupt files. | §7A | major | Crash test + concurrent save test |
| R-08 | Settings `saveSettings` swallows server errors; user can lose changes silently if backend is down. | §3 | minor | §3 TC3.x backend-down save |
| R-09 | Import Graph and Load Test Fixture replace the entire graph **with no confirm dialog**. Destructive without warning. | §3 | minor | §3 TC3.x import without confirm |
| R-10 | Run Maintenance multi-agent loop overwrites `setMaintenanceReport`; only the last agent's report is shown. | §3 | minor | §3 TC3.x multi-agent maintenance |
| R-11 | `applyPatch` (programmatic graph patches) bypasses `AgentNameDialog`, leaving agents with `nameConfirmed: false` and no prompt. | §1 | minor | §1 TC1.x applyPatch |
| R-12 | `clearGraph` does not call `destroyAgent` — live runtimes orphaned on the server. | §1 | minor | Clear graph during active run; observe server |
| R-13 | `isValidConnection` (drag validator) and `onConnect` (store accept) have **different** rules — programmatic vs drag-drop diverge. | §1 | minor | §1 TC1.x connection rules |
| R-14 | Keyboard delete vs `removeNode` divergence — keyboard path doesn't explicitly filter dangling edges. | §1 | minor | §1 TC1.x keyboard delete |
| R-15 | No reserved tool names; only normalize+conflict detect. A user tool can shadow a built-in. | §7B | minor | §7B TC7B.5 |
| R-16 | Tool-lock from Safety settings is **not wired** in `server/hitl/`. The Safety toggle has no enforcement path today. | §7B | major | §3 + §7B cross-check; expected vs actual |
| R-17 | Tool registry honors `disabled: true` only at scan time — restart required. Toggling at runtime has no effect. | §7B | minor | §7B TC7B.20 |
| R-18 | Memory engine: tools are `memory_search` / `memory_get` / `memory_save` — not `recall_memory` / `save_memory` as referenced in some plans. Daily reset / idle reset / parent-fork-max-tokens are **not implemented** in `memory-engine.ts`; backend is in-memory `Map`s only. | §6B | major | §6B TC6B.x and resolve naming for §2 + §3 + property editors |
| R-19 | `server/connections/` is the WS + webhook front door, **not** connector-lifecycle code. Naming collides with the connector-node concept in docs. | §6B, §7A | cosmetic (doc) | doc-only |
| R-20 | `auth/api-keys.ts` is an in-memory provider key cache — **not** request auth. There is no per-route auth middleware. The deployment posture is single-trusted-user only. | §7A | major (security context) | Security review out of scope of QA, but document explicitly |
| R-21 | Skills node only stores `enabledSkills: string[]`; the rich `SkillDefinition {name, body, ...}` lives on `ToolsNodeData.skills` and has **no UI**. Two skill surfaces with different capabilities. | §2 | minor | §2 TC2.x skills round-trip |
| R-22 | Memory editor's compaction-strategy select drops `trim-oldest`, even though Context Engine offers it. | §2 | cosmetic | §2 TC2.x memory compaction |
| R-23 | Agent Comm editor "filter out connected agent" comment doesn't match implementation. | §2 | cosmetic | code review |
| R-24 | `shared.tsx` `Field` lacks `htmlFor` / `id` plumbing — root cause of the prior a11y finding (`F-05`: 156 + 86 issues). | §2 | minor | a11y audit |
| R-25 | Cron node not draggable from default Sidebar palette today. | §2, §6B | minor (in-progress surface) | Reach via fixture import or REST only |
| R-26 | Vector Database, MCP, parts of Connectors are **config-only** with partial runtime wiring — fields exist with no observable effect. | §2 | major (UX trap) | §2 TC2.x for each, document expected-vs-actual |
| R-27 | Session selector caps at 3 in the chat drawer (`enforceSessionLimit(agentId, 3)`), independent of storage `sessionRetention=50`. Sessions cannot be renamed from the UI. | §4 | minor | §4 TC4.x session cap |
| R-28 | "Auto-close" (`autoClose.ts`) is **not** drawer auto-close — it's the streaming markdown token-balancer. The drawer only closes via `X` or external `chatAgentNodeId` clear. Naming hazard. | §4 | cosmetic (doc) | §4 TC4.x close |
| R-29 | `STREAM_IDLE_TIMEOUT_MS` declared in agent-runtime but its trigger site within `executeRun` was not directly verified during section authoring. | §6A | minor | §6A targeted test |
| R-30 | HITL registry is in-memory only — server restart drops pending approvals. | §7B | minor | §7B TC7B.x restart with pending HITL |
| R-31 | `dev:server` is **not** `--watch` (deliberate, per README). File edits do not hot-reload. Expected behavior — but easy to mistake for a regression. | §7B | doc | confirmation only |
| R-32 | Sam Agent server uses its **own** `HitlRegistry` instance — separate from the runtime HITL queue. Cross-talk impossible by design. | §7B | doc | confirmation only |

Prior findings still in scope (from [`docs/superpowers/specs/2026-05-07-e2e-chrome-devtools-test-findings.md`](../superpowers/specs/2026-05-07-e2e-chrome-devtools-test-findings.md)):

- **F-01**: README/WS claim — re-verified as wired in §4 + §7A. Update README rather than re-test.
- **F-02**: storage config in query string — see R-06.
- **F-03**: stale model error in transcript — symptom of F-06/R-01.
- **F-04**: README documents 4 settings sections, app has 8 — doc drift only.
- **F-05**: 156 + 86 a11y issues — see R-24.
- **F-06**: stale default model id — see R-01.
- **F-07**: connector validator orphan — see R-05.

---

## 7. Coverage matrix by node type

For each node type, this is the one-stop pointer set. Use this when you want to **fully exercise one node type top to bottom**.

| Node type | Editor (§2) | Resolution (§5) | Runtime (§6A/B) | Server surface (§7A/B) | Chat render (§4) |
|---|---|---|---|---|---|
| `agent` | F2.agent | R5.1–R5.4 (root validation, persona) | §6A factory + runtime | §7A agents CRUD | §4 message bubble |
| `provider` | F2.provider | R5.5 (provider lookup) | §6A model-resolver | §7A `/api/providers/*` | error inline |
| `memory` | F2.memory | R5.10 (memory tools fold) | §6B memory-engine | §7B memory tools | tool-call render |
| `tools` | F2.tools (9 sub-pages) | R5.6–R5.8 (profile/group/enabledTools/plugins) | §6A tool dispatch | §7B tool-factory + builtins | tool-call render |
| `skills` | F2.skills (note R-21) | R5.9 (skill folding into prompt) | — | — | reflected in prompt only |
| `contextEngine` | F2.contextEngine | R5.11 (budget) | §6B context-engine + §6A compaction-handler | — | §4 ContextUsagePanel |
| `agentComm` | F2.agentComm | R5.12 (channel config) | §6B agent-comm-bus | §7A `routes/agent-channels.ts` + WS | §4 PeerChannelsSection |
| `connectors` | F2.connectors (note R-05) | R5.13 (skipped silently if empty) | §6A as MCP fold | §7B MCP/tool surface | tool render |
| `storage` | F2.storage | R5.14 (config defaults) | §6B session-router | §7A storage-engine + transcript-store | session list |
| `vectorDatabase` | F2.vectorDatabase (note R-26) | R5.15 (config-only) | not wired | not wired | none today |
| `mcp` | F2.mcp (note R-26) | R5.16 (mcps fold) | §6A tool dispatch | §7B MCP discovery | tool render |
| `subAgent` | F2.subAgent | R5.17 (sub-agent inheritance/conflicts) | §6A sub-agent-executor + §6B registry | §7B session-tools.spawn | nested transcript |
| `cron` (note R-25) | F2.cron | R5.18 (schedule serialization) | §6B cron-scheduler | not in default palette | — |

---

## 8. Coverage matrix by user-visible surface

For testers who think in screens rather than nodes:

| Surface | Sections to consult |
|---|---|
| App shell + canvas + palette | §1 |
| Right-hand properties panel | §2 |
| Settings workspace (8 sections) | §3 |
| Chat drawer | §4 |
| Streaming markdown / tool calls / thinking | §4 + §6A stream-transforms |
| HITL banner | §4 + §7B HITL + §3 Safety |
| Peer channels section | §4 + §6B + §7A |
| In-app SAM Agent island | §4 + §7B server SAM agent |
| Context usage panel | §4 + §6B context-engine + §6A payload-breakdown |
| Session selector + transcript hydration | §4 + §7A session-router + transcript-store |
| Graph export / import / fixture | §3 + §7A graph-file-store |
| Storage maintenance reports | §3 + §7A storage-engine |
| `sam` CLI | §7B |

---

## 9. Capstone — User Acceptance Tests (Win Condition)

This is the **acceptance bar for the product**: a tester (or product owner) validates, in order, that a real end user can do real work without writing code or hand-editing JSON. **UAT.1 → UAT.9 are build-up steps; UAT.10 is the win condition** — replicating the multi-agent content pipeline from the reference image.

Reference image of the win-condition workflow: save it alongside this plan as [`docs/e2e/capstone-reference-workflow.png`](./capstone-reference-workflow.png). The architecture is also described textually in UAT.10 below so the doc remains usable if the image is lost.

### Prerequisites for the capstone pass

- App stack running (`npm run dev`).
- At least one provider key configured.
- For UAT.6 / UAT.10: ability to install a small custom tool from a GitHub repo (or local `sam.json` + `*.module.ts`).
- Awareness of the open risks in §6 — several UATs depend on subsystems still tagged in-progress: **R-25** (cron not in palette), **R-26** (vector DB / MCP config-only), **R-18** (memory engine in-memory only), **R-16** (Safety tool-lock not wired).

### How to score

Each UAT is **pass / partial / fail**. UAT.10 is **binary** — the product either replicates the reference architecture and runs end-to-end, or it doesn't. Partial passes on UAT.1–UAT.9 must be itemized so they don't silently stack into a UAT.10 failure.

---

### UAT.1 — Drag-and-drop a single working agent

**Goal**: A user creates a chatting agent without typing anything except the message and the provider key.

**Steps**:
1. Empty canvas.
2. Drag `Agent`, `Provider`, `Storage`, `Context Engine` from the palette.
3. Wire each peripheral to the agent (only valid edges should connect — see §1, R-13).
4. Open the Agent property editor; set provider/model to a current valid id (note **R-01**: default is stale).
5. Open chat from the agent node; send `"ping"`.

**Pass**: Reply received, transcript persists across reload. Maps to §1, §2, §4. No console errors.

**Risks hit**: R-01 (stale default model id).

---

### UAT.2 — SAM Agent: configure every node type via natural language

**Goal**: User opens the SAM Agent panel and changes configuration on every node type using plain English. Apply / discard works.

**Steps**:
1. Have one of every peripheral node type on the canvas (agent, provider, memory, tools, skills, contextEngine, agentComm, connectors, storage, vectorDatabase, mcp, subAgent, cron — the last two flagged R-25 / R-26).
2. For each node, select it and instruct the SAM Agent panel to change at least one field, e.g.:
   - "Set this storage node's retention to 100 sessions and disable daily memory."
   - "Set the context engine's token budget to 200,000 with the trim-oldest compaction strategy."
   - "Add the `web_fetch` and `calculator` tools to this Tools node and turn off the `read_url` plugin."
   - "Rename this agent to 'Researcher' and set its modelId to <a current valid id>."
3. Apply via the apply-card; verify the property panel reflects the change.
4. Discard a different change; confirm it was NOT applied.
5. Repeat across every node type in the palette.

**Pass**: Apply works for every supported node type; discard works; SAM Agent surfaces a coherent diff before applying. Streaming and the apply-card flow do not interfere with each other.

**Risks hit**: R-32 (SAM Agent server uses its own HitlRegistry — verify cross-talk impossibility).

---

### UAT.3 — SAM Agent: build an agent from scratch via natural language

**Goal**: User says, in one prompt, "Build me a research agent that uses the brave_search tool, with a 100k token context budget, and the storage retention at 50 sessions."

**Steps**:
1. Empty canvas. Open the SAM Agent panel.
2. Issue the build instruction.
3. Apply the suggested patch.
4. Verify: graph contains agent + provider + storage + context engine + tools nodes with the requested config; edges valid.
5. Open chat; send a query that should exercise the configured tool; verify the tool is actually invoked.

**Pass**: Graph built end-to-end from one NL prompt; tool fires.

---

### UAT.4 — SAM Agent: build a multi-agent workflow via natural language

**Goal**: One NL prompt produces three agents communicating via agent-comm.

**Steps**:
1. Empty canvas.
2. Issue: "Build me a manager agent that delegates to a researcher and a writer; the manager talks to each via agent-comm channels with a turn limit of 8."
3. Apply.
4. Verify: 3 agents, 2 channels via AgentComm nodes, correct turn limits, manager prompt routes via channel.
5. Live chat traces show A → channel → B and back.

**Pass**: Apply card includes channel config; live runs respect turn/depth/token limits per §6B.

**Risks hit**: R-02 (process-global serialization may flatten A/B parallelism — confirm observed behavior).

---

### UAT.5 — Tool effectiveness — built-in tools

**Goal**: An agent calls calculator, web_fetch, memory tools, session tools and uses results materially.

**Steps**:
1. Build an agent with the four real built-in tool families enabled (per §7B inventory).
2. Send four prompts:
   - `"Compute (37 * 41) - 19"` → calculator.
   - `"Fetch the title of https://example.com"` → web_fetch (note SSRF guard — do not give private IPs).
   - `"Remember my favorite number is 7"`, then in a NEW message `"What's my favorite number?"` → memory_save / memory_search (note **R-18**: memory is in-memory; restart loses it).
   - `"List the last 5 messages from this session"` → session-tools list / yield.
3. For each tool, verify the args, the result, and that the model's next message uses the result materially (not just echoes it).

**Pass**: Each tool fires with sane args and the model's next reply is informed by the tool result.

**Risks hit**: R-18.

---

### UAT.6 — Custom tool: install end-to-end via the SAM CLI

**Goal**: A user installs a third-party tool from GitHub via `sam install tool` and an agent uses it.

**Steps**:
1. `sam install tool <github-url-of-known-good-module>` — synthesizes `sam.json` if missing, validates the module.
2. `sam restart` (note Windows console-flash and concurrently+vite caveats per README).
3. `sam list tools` — new tool listed; not dimmed.
4. Build an agent enabling the new tool from the Tools editor.
5. Trigger the tool from chat; verify it runs and result reaches the model.
6. `sam disable tool <name>`; `sam restart`; verify backend log `[tool-registry] skipping <name>: disabled via sam.json`; agent can no longer use it.
7. `sam enable tool <name>`; restart; back to working.
8. `sam uninstall tool <name>`; verify directory removed.

**Pass**: Full lifecycle works. No process leaks. README caveats observed.

**Risks hit**: R-15 (no reserved tool names — try one that shadows a built-in and document outcome), R-17 (toggle requires restart — toggling without restart must NOT take effect mid-runtime).

---

### UAT.7 — Sub-agent spawn

**Goal**: Parent agent has access to a sub-agent and uses it.

**Steps**:
1. Two agents on canvas; the second is exposed to the first via a SubAgent node.
2. Parent prompt instructs delegation in plain language.
3. Send a request that should delegate.
4. Verify: nested transcript shows parent → spawn → sub-agent run → return → parent continuation.
5. Set depth limit = 1; trigger recursion; verify block.

**Pass**: Sub-agent fires, returns, parent uses the result. Depth limit halts deep nesting.

---

### UAT.8 — Hooks: `on_agent_finish` writes via a tool

**Goal**: A configured `on_agent_finish` hook (per §6B hook tier 1) fires on run completion and invokes a side-effecting tool (e.g., a database insert tool).

**Steps**:
1. Configure an agent with an `on_agent_finish` hook that calls a "store result" tool — could be a custom tool installed via UAT.6.
2. Run the agent.
3. Verify the hook fires exactly once per run; the tool invocation is observable in transcript and side-effect store.

**Pass**: Hook fires once per run; observable side effect.

---

### UAT.9 — Vector DB idempotency check

**Goal**: A `save_headlines`-style tool checks vector similarity and refuses near-duplicates.

**Steps**:
1. Build a minimal agent with a Vector Database node and a custom save-with-similarity-check tool.
2. Submit a headline; verify it is inserted into the vector DB.
3. Submit a near-duplicate (e.g., same headline rephrased); verify the insert is **skipped** with a clear log/event.
4. Submit a clearly different headline; verify it IS inserted.

**Pass**: Idempotency is enforced; clear distinction between near-duplicate and distinct inputs.

**Risks hit**: R-26 (vector DB is config-only today). If this UAT cannot pass, log it as a **gating blocker for UAT.10** and skip UAT.10's idempotency criterion.

---

### UAT.10 — WIN CONDITION: Multi-agent content pipeline

**Goal**: Replicate, in the canvas, the architecture in the reference image and run it end-to-end. The user must build it using a mix of drag-and-drop, property editors, SAM Agent natural-language, and `sam install tool` — without hand-editing JSON, transcript files, or any storage on disk.

#### Reference architecture (description of the attached image)

Three orchestrator agents under one MANAGER, three persistent stores, and ten or more total runtimes (orchestrators + sub-agents + checkers).

**Stage 1 — News Research** (left third of the image):

- **TREND MONITOR**: top-of-pipeline trigger, likely Cron-driven, fires the manager on a schedule. _Cron node — see R-25._
- **MANAGER**: top-level agent connected via agent-comm to all three orchestrators.
- **News Research Orchestrator**: agent with Skills / Scripts / Agents / Database / Web tools. System prompt (verbatim from image): _"Research 'tech' news from the last 24 hours. Extract the top 4 headlines and output them strictly as a JSON array of objects with the keys headline, category, and date. Save the output in the database using save_headlines tool."_
  - Tools wired: Brave / Google / FireCrawl `search_news`, `top_reports`, `save_headlines`.
  - `save_headlines` semantics: searches the vector DB for similarity; on a near-duplicate, **stops the insert** (idempotency).
  - Vector store table `NEWS_HEADLINE` (fields: `headline_text`, `has_report`, `report_id`, `category`, `timestamp`, `general_topic`).
- **research_sub_agent**: queries the vector DB for headlines with `has_report=false`, top 3, **spawns one sub-agent per headline**.
- **NEWS HEADLINE SUBAGENTS (×3)** — fan-out:
  - Prompt (verbatim): _"Produce a comprehensive, fact-checked research brief on this headline. You have search, fetch, and database tools. Decide how deep to go based on topic complexity and output them strictly as a JSON array of objects with the keys SOURCES, CONTENT, and TAGS."_
  - Tools: Database, Web.
  - `on_agent_finish_hook`: _"inserts it into the regular database, gets the new report_id, and updates the vector database metadata"_ (sets `has_report=true` on the matching `NEWS_HEADLINE` row).
- **Regular DB table** `NEWS_RESEARCH` (`ID`, `TAGS`, `CONTENT`, `SOURCES`, `POSTS`, `POSTS_ID`).
- Image annotations: "Top reports" tool, "ToDo Idempotency Checks" on both DB pipelines.

**Stage 2 — Content Writing** (middle third):

- **Content Writer Orchestrator**: agent with Skills / Posts / Agents / Database / Web tools.
- **content_sub_agent**: _"fetch database for research with posts false, decide the social media worth posting on, spawn a subagent for each."_
- **CONTENT SUB_AGENT (×3 — one per target platform)**:
  - Prompt (verbatim): _"YOU ARE A SOCIAL MEDIA CONTENT CREATOR. WRITE A POST FOR <SOCIAL MEDIA PLATFORM> THAT IS RELEVANT FOR THE TYPE OF PUBLIC OF THAT SOCIAL MEDIA. RESEARCH YOUR PUBLIC."_
  - Tools: Web, Skills, Database.
  - On finish: pings for review.
- **content_checker_skill (×3 — "1st / 2nd / 3rd AGENT RESULT REVIEW")**:
  - "Check how many runs the agent that did the post has; if > 3 go to the next."
  - "If more pending, or stop if last and report back to avoid loop."
  - "Fetch the database and web for the original research and fact-check the post."
  - "If approved: insert into posts table, update research table."
  - "If denied: restart the agent expanding on the error and the reasons."
- **YES / NO branches**: NO triggers RETRY into the corresponding content sub-agent; YES advances to Stage 3.
- Image annotation: _"MAYBE SPLIT FACT CHECK / LET THE AGENT DECIDE."_

**Stage 3 — Social Media Posting** (right third):

- **Social Media Orchestrator**: agent with Skills / Posts / Agents / Database / Web tools.
- _"FETCHES POSTS THAT HAVE NOT BEEN PUBLISHED, DECIDES WHAT TOOL TO USE."_
- Top-level tool: `SOCIAL_MEDIA_POSTING`.
- **Per-platform pairs (×3)**:
  - LinkedIn: `POST` → `POST_CHECKER`.
  - Reddit: `POST` → `POST_CHECKER`.
  - Facebook: `POST` → `POST_CHECKER`.
- **Regular DB tables**:
  - `SOCIAL_MEDIA_POST` (`ID`, `CONTENT`, `IMAGE`, `IS_POSTED`, `NEWS_RESEARCH_ID`).
  - `POST_FEEDBACK` — TO BE DEFINED.

**Cross-stage join keys**:
- `NEWS_HEADLINE.report_id` ↔ `NEWS_RESEARCH.ID`.
- `NEWS_RESEARCH.ID` ↔ `SOCIAL_MEDIA_POST.NEWS_RESEARCH_ID`.

#### What the user must do to pass UAT.10

The tester will:

1. **Drag-and-drop** the visual layout: 1 Manager + 3 Orchestrators + 3 research sub-agents + 3 content sub-agents + 3 content checkers (skills) + 3 social media tool pairs + Storage + ContextEngine + Memory + VectorDatabase + Cron (only if R-25 is resolved). All agent-comm channels and SubAgent node references wired.
2. Use the **SAM Agent panel** for at least three NL configuration tasks:
   1. "Set the three news headline sub-agents' prompts to the JSON-output research brief from the spec."
   2. "Wire the manager via agent-comm to all three orchestrators with a turn limit of 12 and depth limit of 4."
   3. "Configure the on_agent_finish hook on each headline sub-agent to call the upsert-research tool."
3. Use **`sam install tool`** to add at minimum:
   1. A `search_news` tool (Brave / Google / FireCrawl variant) — or document which built-in covers it today.
   2. A `social_media_posting` tool with platform sub-tools (LinkedIn, Reddit, Facebook).
   3. A `post_checker` tool that verifies the post landed.
   4. A `save_headlines` / vector-similarity tool (depends on R-26).
4. Trigger the pipeline (manually from chat against the MANAGER, or via Cron if R-25 is resolved).
5. Verify, end-to-end without manual intervention:
   - At least one `NEWS_HEADLINE` row in the vector DB.
   - At least one `NEWS_RESEARCH` row in the regular DB linked by `report_id`.
   - At least one `SOCIAL_MEDIA_POST` row per platform linked by `NEWS_RESEARCH_ID`.
   - The duplicate-headline path proves vector idempotency.
   - At least one `content_checker_skill` retry observed AND at least one approval reaches Stage 3.
   - Total checker retries respect the "> 3 → give up and move to next" cap (no infinite loop).

#### Pass criteria (binary)

The product passes UAT.10 if and only if **all five** are true:

1. The graph in the canvas visually mirrors the reference image (10+ runtimes, 3 orchestrators, 3 stores, 3 platform tool pairs).
2. Every node was configured via property editors, SAM Agent NL, or `sam install tool` — **no hand-editing of saved JSON**, no shell-edits to `~/.simple-agent-manager/storage/*.json`.
3. End-to-end run produces at least one Stage 3 social media post derived from a Stage 1 headline via Stage 2 review.
4. The pipeline is **idempotent**: a second run on the same headline does not duplicate it (vector similarity stops the insert).
5. The pipeline is **bounded**: content_checker_skill caps retries at 3 (no infinite loop, no zombie runs).

#### Known prerequisites that may block UAT.10 today

If unresolved, these risks must be reported as **gating findings**, and UAT.10 is marked **partial** with a list of which stage was reachable and which criterion gated:

- **R-25** Cron node not in default palette → TREND MONITOR cannot be wired without code-side work. Workaround: trigger the MANAGER manually from chat.
- **R-26** Vector Database / MCP / parts of Connectors are config-only → idempotency check (criterion 4) cannot be enforced. Workaround: skip criterion 4 and document.
- **R-18** Memory engine is in-memory only → cannot back persistent stores; all state lost on `sam restart`. Workaround: install a custom-tool–backed DB layer.
- **R-16** Tool-lock from Safety not wired → if the workflow needs runtime tool gating, this is a blocker.
- **R-15** No reserved tool names → custom tool installs must not collide silently with built-ins.
- **R-02** Process-global run serialization → fan-out at "spawn 3 sub-agents in parallel" may serialize globally. Document observed behavior; not necessarily a fail if work still completes.

#### Suggested test artifacts

Because UAT.10 is large, the tester should produce and attach to the run report:

1. **A canvas screenshot** matching the reference, with names visible.
2. **Run-event traces** for one full pipeline pass (chat transcripts of each orchestrator + sub-agent).
3. **DB dumps** (or REST `GET`s) for the three persistence layers showing the join keys.
4. **A duplicate-headline replay log** demonstrating the vector idempotency check fires.
5. **Server log excerpt** showing tool registration on `sam restart` and per-run hook fires.

---

## 10. Out of scope

Same as the prior plan, plus a few additions:

- **Automated regression**: covered by `e2e/` Playwright specs and the `npm test` suites — out of scope here.
- **Performance benchmarking and load testing.**
- **Mobile / non-Chromium viewports.**
- **Server-side unit-level verification** (covered by `npm run test:run`).
- **Security review** (auth, sandboxing, secret handling) — flagged as R-20 but not exercised by QA.
- **Fixing any of the bugs found.** This is a coverage-design pass, not a fix pass.
- **Live paid-API usage beyond the minimum** to validate P1/P2/CC scenarios.

---

## 11. Findings format (for the test execution pass)

Re-using the format from the prior plan so reports are interchangeable.

```
### F-NN — Short title

- **Phase:** P1 / P2 / P3 / P4 / P5 (cross-cutting CC.x is P4)
- **Severity:** blocker / major / minor / cosmetic
- **Surface:** e.g. "Settings → Defaults"
- **Repro:** Numbered steps from a clean app load.
- **Expected:** What should happen.
- **Actual:** What happened. Console errors, network failures, screenshots if captured.
- **Risk ID hit:** R-NN if this is a known risk being verified.
- **Notes:** Optional — relevant code paths, hypotheses.
```

Severity definitions:

- **blocker** — feature cannot be used at all from the UI.
- **major** — data loss risk, crash, or core flow broken.
- **minor** — visible bug but workaround exists.
- **cosmetic** — copy, alignment, polish.

---

## 12. Maintenance

If you change any of the source surfaces below, update the matching section file **and** this master plan's risk register if a risk changes.

| Source area | Section file to update |
|---|---|
| `src/canvas/`, `src/nodes/`, `src/edges/`, `src/store/graph-store.ts`, `src/utils/default-nodes.ts`, `src/types/nodes.ts` | §1 |
| `src/panels/property-editors/`, `src/panels/PropertiesPanel.tsx` | §2 |
| `src/settings/` | §3 |
| `src/chat/`, `src/runtime/` (browser-side), `src/store/session-store.ts` | §4 |
| `shared/agent-config.ts`, `shared/system-prompt-builder.ts`, `shared/resolve-tool-names.ts`, `shared/protocol.ts`, `src/utils/graph-to-agent.ts` | §5 |
| `server/agents/`, `server/runtime/agent-runtime.ts`, `server/runtime/model-resolver.ts`, `server/runtime/stream-wrapper.ts` | §6A |
| `server/runtime/context-engine.ts`, `server/runtime/memory-engine.ts`, `server/hooks/`, `server/comms/`, `server/scheduling/` | §6B |
| `server/index.ts`, `server/routes/`, `server/auth/`, `server/storage/`, `server/sessions/` | §7A |
| `server/tools/`, `server/hitl/`, `server/skills/`, `server/sam-agent/`, `bin/` | §7B |

When you update a section, also update its `<!-- last-verified: YYYY-MM-DD -->` comment.

---

## 13. Total volume

- **9 section files**, ~5,000 lines, ~327 KB.
- **~280 distinct features** documented at file:line granularity.
- **~263 per-section test scenarios** + **12 cross-cutting (CC.1–CC.12)** + **32 risk-driven scenarios (R-01–R-32)** + **10 capstone UATs (UAT.1–UAT.10)** with one binary win condition ≈ **~320 testable scenarios** total.

Use the section files for breadth, §5 for cross-cutting flows, §6 for risk-driven coverage, and **§9 (Capstone UATs)** as the final acceptance bar. UAT.10 is the win condition: replicate the multi-agent content pipeline from the reference image end-to-end without hand-editing JSON.
