# Feature Roadmap

> A living survey of where Simple Agent Manager stands against the fast-moving
> agent-tooling landscape, and a prioritized list of features to keep it
> current. Maintained as a recurring task — update statuses as items land.

<!-- last-updated: 2026-06-20 -->

## How to read this

Each proposal lists a **status**, a one-line **why now**, and the **surfaces it
touches**. Statuses:

- 🟢 **Shipped** — wired end-to-end (UI → resolve → runtime).
- 🟡 **Scaffolded** — schema, defaults, UI, and graph resolution exist; runtime
  wiring is partial or pending. Matches how `connectors`, `vectorDatabase`, and
  `cron` already sit in the repo.
- ⚪ **Proposed** — not started; captured here so a future iteration can pick it
  up.

The node-scaffolding recipe (the files every new node type touches) is at the
bottom so each proposal can be executed consistently.

## Current node palette (baseline)

`agent`, `memory`, `tools`, `skills`, `contextEngine`, `agentComm`,
`connectors`, `storage`, `vectorDatabase`, `cron`, `provider`, `mcp`,
`subAgent`, `guardrails`, `observability`.

The builder already covers a lot of modern ground: MCP servers, sub-agent
orchestration, guardrails, a vector-DB surface, and provider plugins. The gaps
below are the pieces the broader ecosystem (OpenAI AgentKit, LangGraph,
Anthropic Agent SDK, n8n, Langfuse/Braintrust) has converged on that this repo
does not yet express.

## Proposals

### 1. Observability / Telemetry node — 🟡 Scaffolded
**Why now:** trace-based debugging, token/cost accounting, and latency
dashboards are table stakes for anything running agents in 2026. The repo had
token *estimation* but no run-level tracing surface.
**Surfaces:** `observability` node — schema, defaults, palette, property editor,
`AgentConfig.observability`, concept doc. Runtime span emission in
`server/agents/run-coordinator.ts` is the remaining work (OTLP/console/Langfuse
exporters, sampling, PII redaction).
**Next step:** implement a `TraceEmitter` in `server/runtime/` that the run
coordinator feeds, honoring `sampleRate`, capture toggles, and `latencyWarnMs`.

### 2. Evaluations / Eval-driven development — ⚪ Proposed
**Why now:** eval-first agent development (datasets + LLM-as-judge + regression
gates) is the dominant workflow shift of the last year (OpenAI Evals,
Braintrust, LangSmith). A visual builder that can't test its agents is hard to
trust in production.
**Shape:** an `evals` node holding a dataset reference (inline cases or a file),
a scoring strategy (`exact`, `contains`, `llm-judge`, `json-schema`), a judge
model, and a pass threshold. Resolves into `AgentConfig.evals`; a server
`eval-runner` executes the suite against the agent and reports pass rate.
**Surfaces:** new node + `server/runtime/eval-runner.ts` + a results panel in
the chat/settings workspace.

### 3. Triggers / Webhooks (event-driven runs) — ⚪ Proposed
**Why now:** `cron` covers time-based runs, but inbound events (webhooks,
email, queue messages, GitHub events) are how most real agents are invoked.
**Shape:** a `trigger` node with `kind` (`webhook` | `email` | `queue`), an
auth/secret binding, and a payload-to-prompt template. The server exposes a
registered inbound route per trigger and starts an ephemeral session on hit.
**Surfaces:** new node + `server/triggers/` route registry + run-coordinator
entry point that mirrors the cron scheduler.

### 4. Budget & rate governance — ⚪ Proposed
**Why now:** runaway loops and token spend are the top operational risk for
autonomous agents. `agentComm` already has per-channel loop controls; agents
need the same at the top level.
**Shape:** a `budget` node (or fields on `agent`) for max tokens/run, max
USD/session, max tool calls, and an action on breach (`stop` | `warn`). Pairs
naturally with the Observability cost counters.
**Surfaces:** new node or `AgentConfig.budget` + enforcement in the run
coordinator's turn loop.

### 5. Structured-output / response-schema node — ⚪ Proposed
**Why now:** structured outputs (JSON schema / tool-forced responses) are how
agents hand off to downstream systems reliably. The builder has no way to pin
an output contract.
**Shape:** a `responseSchema` node carrying a JSON Schema and a strictness mode
(`strict` | `best-effort`); the runtime passes it to the provider's structured
-output API and validates before returning.

### 6. Knowledge / RAG ingestion node — ⚪ Proposed
**Why now:** `vectorDatabase` defines *where* vectors live but nothing defines
*what* gets ingested. A `knowledge` node (sources: files, URLs, sitemaps;
chunking + embedding config) would close the RAG loop the context engine's
`ragEnabled` flag already anticipates.

### 7. Human-in-the-loop / approval node — ⚪ Proposed
**Why now:** the Safety settings have a global HITL toggle, but per-tool /
per-step approval gates as first-class graph nodes make the policy visible and
composable. Mirrors LangGraph interrupts and AgentKit approvals.

## Prioritization

| Rank | Feature | Status | Rationale |
|------|---------|--------|-----------|
| 1 | Observability | 🟡 | Foundational; unblocks cost/eval/budget signals. |
| 2 | Evaluations | ⚪ | Highest-leverage workflow gap. |
| 3 | Triggers | ⚪ | Turns the builder from demo into a service. |
| 4 | Budget governance | ⚪ | Cheap to add once Observability emits cost. |
| 5 | Structured output | ⚪ | Small surface, high downstream value. |
| 6 | Knowledge/RAG ingestion | ⚪ | Completes the existing RAG anticipation. |
| 7 | HITL approval node | ⚪ | Promotes an existing setting to a graph node. |

## Node-scaffolding recipe

Adding a new peripheral node type touches these files (use `observability` as
the reference implementation):

1. `src/types/nodes.ts` — add to `NodeType`, define `<Name>NodeData`, add to `FlowNodeData`.
2. `src/utils/default-nodes.ts` — add a `case` returning defaults.
3. `src/utils/theme.ts` — add `NODE_COLORS`, `NODE_PASTEL`, `NODE_LABELS` entries (TS enforces completeness).
4. `src/app.css` — add `--color-node-<x>` mapping and `--c-node-<x>` value.
5. `src/nodes/<Name>Node.tsx` — canvas component (wrap `BasePeripheralNode`).
6. `src/nodes/node-registry.ts` — register the component.
7. `src/panels/Sidebar.tsx` — add a palette item + lucide icon.
8. `src/panels/property-editors/<Name>Properties.tsx` — the editor.
9. `src/panels/PropertiesPanel.tsx` — import + `switch` case.
10. `shared/agent-config.ts` — `Resolved<Name>Config` + optional `AgentConfig` field.
11. `src/utils/graph-to-agent.ts` — resolution block + add to the returned config.
12. `docs/concepts/<name>-node.md` + `docs/concepts/_manifest.json` — concept doc + mapping.
13. `src/utils/graph-to-agent.test.ts` — a resolution test.

Verify with `npm run build` and `npx vitest run src/utils/graph-to-agent.test.ts`.
