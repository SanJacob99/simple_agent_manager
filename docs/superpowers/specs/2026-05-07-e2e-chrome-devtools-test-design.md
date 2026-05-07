# E2E Chrome DevTools Test Plan

<!-- last-verified: 2026-05-07 -->

## Goal

Run an interactive end-to-end test of Simple Agent Manager via the `chrome-devtools` MCP, exercising every user-facing surface that the app currently exposes. Capture every failure or surprise in a findings doc, including the surfaces flagged in the README as "in-progress" — they are explicitly in scope for this run.

## Operating context

- **Test agent:** Claude (this session), driving Chrome via `mcp__plugin_chrome-devtools-mcp_chrome-devtools__*`.
- **Dev servers:** I start `npm run dev` in the background. Frontend at `http://localhost:5173`, backend at `http://localhost:3210`.
- **Provider key:** Pre-configured in browser localStorage. The plan verifies it works during the chat round-trip; it is not entered or echoed.
- **Model:** Whatever the user has set as the default provider/model in Settings → Defaults. If none is set, this is a P2 finding and the chat phase is skipped.
- **Scope:** Treat every observable failure as a finding regardless of whether the README marks the surface as in-progress. The user has explicitly opted into this.

## Phases

The run has four phases. P1 and P2 are gates: if P1 fails the run aborts; if P2 fails I record it loudly and continue with reduced expectations for P3/P4.

### P1 — Smoke (~2 min)

| # | Check | Pass criteria |
|---|---|---|
| 1.1 | `GET http://localhost:3210/api/health` | 2xx response |
| 1.2 | Open `http://localhost:5173/` | App shell renders, no uncaught exceptions in console |
| 1.3 | Console message scan | No `error`-level messages on initial load |
| 1.4 | Network request scan | No 4xx/5xx requests on initial load |
| 1.5 | Drag a node from the palette onto the canvas | Node appears, is selectable |
| 1.6 | Open Settings | Settings workspace renders, sidebar lists all sections |

### P2 — Critical happy path (~10 min)

End-to-end build of the smallest agent that can chat, plus one real model round-trip.

1. Clear or reset the canvas.
2. Drag `Agent`, `Context Engine`, and `Storage` nodes onto the canvas.
3. Connect Context Engine → Agent and Storage → Agent.
4. In the Agent property editor: confirm provider/model is set (or set it).
5. Open the chat drawer from the agent node.
6. Send a short prompt (`"Reply with exactly the word 'pong'."`).
7. Verify: streamed response arrives, no console errors, transcript persisted (refresh page → message still there).
8. Backend log check: WebSocket connection established, run lifecycle events fire.

If any of 1–7 fails, log as P2 finding and decide whether to continue.

### P3 — Surface sweep (~30 min)

Systematic coverage of every UI surface. For each item: open it, change at least one field, save, observe console + network.

**Settings sections:**

- Providers & API Keys
- Model Catalog (incl. OpenRouter sync)
- Defaults
- Data & Maintenance (graph import, graph export, fixture load — but **no destructive ops** like reset without explicit user confirmation)
- Appearance
- Colors
- Safety
- Sam Agent

**Node property editors** (open each, edit each visible field, save):

- Agent (incl. AgentNameDialog, AgentDeleteDialog flows — non-destructive only)
- Memory
- Tools
- Skills
- Context Engine
- Agent Comm
- Connectors (recent branch — extra attention to catalog selection, validator messages)
- Storage
- Vector Database
- Cron (non-palette; reach via existing fixture or by adding a node manually if possible)
- MCP
- Sub-Agent
- Provider

**Graph operations:**

- Import a saved graph (use bundled fixture)
- Export the current graph; verify JSON shape
- Multiple agents on canvas (validator + selection)
- Disconnecting a required peripheral and observing chat-blocked state

### P4 — Edge cases & in-progress surfaces (~15 min)

- Build an Agent without Context Engine — confirm chat is blocked with a clear message.
- Build an Agent without Storage — confirm chat is blocked with a clear message.
- Connector node with no `connectorId` selected — validator surfaces it.
- Connector node with unknown `connectorId` — validator surfaces it.
- Cron runtime: trigger a configured schedule (if reachable) and observe.
- Vector Database: configure a backend and observe runtime behavior.
- Agent Comm: connect two agents, observe loop/turn limits.
- Tools: enable a placeholder tool name, send a chat that should call it, observe behavior.
- Storage maintenance: run a maintenance op (only the non-destructive variants without confirmation).
- Retention: set a low retention and observe what happens.

## Findings format

Findings live in `docs/superpowers/specs/2026-05-07-e2e-chrome-devtools-test-findings.md`. One H3 per finding:

```
### F-NN — Short title

- **Phase:** P1 / P2 / P3 / P4
- **Severity:** blocker / major / minor / cosmetic
- **Surface:** e.g. "Settings → Defaults"
- **Repro:** Numbered steps from a clean app load.
- **Expected:** What should happen.
- **Actual:** What happened. Console errors, network failures, screenshots if captured.
- **Notes:** Optional — relevant code paths, hypotheses.
```

Severity definitions:

- **blocker** — feature cannot be used at all from the UI.
- **major** — data loss risk, crash, or core flow broken.
- **minor** — visible bug but workaround exists.
- **cosmetic** — copy, alignment, polish.

## Out of scope

- Automated regression — that's what the existing Playwright specs in `e2e/` are for.
- Performance benchmarking.
- Mobile / non-Chromium viewports.
- Server-side unit-level verification (covered by `npm run test:run`).
- Fixing any of the bugs found. Findings are catalogued, not patched, in this run.

## Safety constraints

- No destructive ops (Data & Maintenance reset, deleting agents, dropping storage) without explicit user confirmation in chat first.
- No real money / paid API calls beyond the single P2 chat round-trip plus any in-flow verifications that are unavoidable.
- Provider keys, session contents, and any other secret material are never logged into findings, memory, or commits.

## Deliverables

1. `docs/superpowers/specs/2026-05-07-e2e-chrome-devtools-test-design.md` — this file.
2. `docs/superpowers/specs/2026-05-07-e2e-chrome-devtools-test-findings.md` — created at run start, updated as findings emerge, committed at run end.
3. End-of-run summary message: phases completed, finding count by severity, anything that needs follow-up.
