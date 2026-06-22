# Feature Roadmap — Keeping Pace with Agent Development

<!-- last-updated: 2026-06-22 -->

This document proposes new capabilities for Simple Agent Manager and maps them
onto the existing node-based architecture. It exists to keep the product
current as the agent-engineering landscape moves: eval-driven development,
observability, cost governance, structured outputs, and richer multi-agent and
MCP support are now table stakes for serious agent builders.

Each proposal notes **priority**, **effort**, and the **touchpoints** it would
need in this codebase. The wiring pattern for a new node is well established —
see any recent node (`guardrails`, `subAgent`) for the full set of files:
`src/types/nodes.ts`, `src/utils/default-nodes.ts`, `src/nodes/`,
`src/panels/property-editors/`, `src/panels/PropertiesPanel.tsx`,
`src/panels/Sidebar.tsx`, `src/utils/theme.ts`, `src/app.css`,
`src/settings/color-config.ts`, `shared/agent-config.ts`,
`src/utils/graph-to-agent.ts`, an optional `server/runtime/*` engine, plus a
concept doc and a `docs/concepts/_manifest.json` entry.

## Status legend

- ✅ **Scaffolded** — types, graph resolution, UI, and (where applicable) a
  pure engine exist; full runtime orchestration may still be a TODO.
- 🟡 **Proposed** — designed here, not yet built.

---

## 1. Evals node — ✅ Scaffolded

**Priority: High · Effort: Medium (scoring core done; runner pending)**

Attach a suite of test cases (input + assertions) to an agent and score
responses against `contains` / `not_contains` / `equals` / `regex` / `llm_judge`
assertions. Eval-driven development is the single biggest workflow gap for an
agent builder that already has guardrails and a context engine.

- Scaffolded in this PR: `EvalsNodeData`, `ResolvedEvalConfig`, graph
  resolution into `AgentConfig.evals`, palette + property editor, and a pure,
  unit-tested scoring engine at `server/runtime/evals-engine.ts`.
- Remaining: an orchestration loop that runs the agent once per case, a
  judge-model pass for `llm_judge`, and a results panel in the UI.
- See `docs/concepts/evals-node.md`.

## 2. Observability / Tracing node — 🟡 Proposed

**Priority: High · Effort: Medium**

A peripheral node that configures structured tracing for agent runs and exports
spans to an OpenTelemetry-compatible backend (and/or Langfuse / Arize Phoenix).
The run coordinator already emits a rich event stream; this would map those
events onto the OpenTelemetry **GenAI semantic conventions** (model calls, tool
calls, token usage, latency) and ship them.

- Node config: exporter (`console` | `otlp` | `langfuse`), endpoint, headers,
  sampling rate, redaction toggles.
- Touchpoints: new node + `ResolvedObservabilityConfig`; a
  `server/runtime/trace-exporter.ts` that subscribes to the existing run-event
  stream in `server/agents/run-coordinator.ts`.
- Pairs naturally with the Evals node: traces explain *why* a case failed.

## 3. Cost & budget governor — 🟡 Proposed

**Priority: High · Effort: Medium**

Per-run and per-session ceilings on tokens and estimated dollars, plus a model
**fallback ladder** (drop to a cheaper model when a budget threshold is hit).
The model catalog already carries `ModelCostInfo`, so cost estimation is mostly
a matter of multiplying usage by catalog prices.

- Node config: `maxTokensPerRun`, `maxUsdPerSession`, `onExceed` (`warn` |
  `block` | `downgrade`), fallback model list.
- Touchpoints: enforcement in the run loop, reusing the `guardrail_blocked`
  abort path as a template for a `budget_exceeded` stop reason.

## 4. Structured output / response-schema node — 🟡 Proposed

**Priority: Medium · Effort: Medium**

Constrain an agent's final response to a JSON schema (provider-native structured
outputs where available, validate-and-repair fallback elsewhere). Increasingly
expected for agents used as steps in a larger pipeline.

- Node config: JSON schema, `strict` toggle, repair-retry count.
- Touchpoints: pass the schema through to the model-call layer in
  `server/runtime/`; validate the final message and optionally re-prompt.

## 5. Knowledge / RAG ingestion node — 🟡 Proposed

**Priority: Medium · Effort: Medium-High**

The `vectorDatabase` node exists, but the *ingestion* path is thin. Add a node
that loads documents (files, URLs, globs), chunks and embeds them, and upserts
into a connected vector database — closing the loop with the context engine's
existing `ragEnabled` settings.

- Node config: sources, chunking strategy + size/overlap, embedding model
  (reuse `VectorEmbeddingConfig`), refresh cadence.
- Touchpoints: a `server/runtime/ingestion-engine.ts`; connects to a
  `vectorDatabase` node rather than directly to the agent.

## 6. Triggers node (generalize Cron) — 🟡 Proposed

**Priority: Medium · Effort: Medium**

Cron handles time-based runs; agents increasingly need event-based triggers:
inbound webhooks, file-watch, and message/queue events. Generalize the
scheduler into a triggers surface with cron as one trigger kind.

- Touchpoints: extend `server/scheduling/` into a trigger registry; add an HTTP
  webhook intake route under `server/routes/`.

## 7. Human-in-the-loop approval queue — 🟡 Proposed

**Priority: Medium · Effort: Medium**

The Safety settings already gate dangerous tools with confirmations. Promote
this into a first-class **approval queue**: pause a run awaiting human sign-off,
persist the pending action, and resume on approve/deny — usable for async,
out-of-band approvals rather than only synchronous prompts.

- Touchpoints: build on `server/hitl/` and the existing `ask_user` /
  `confirm_action` tools; add a pending-approvals store and UI surface.

## 8. Agent handoffs / A2A patterns — 🟡 Proposed

**Priority: Medium · Effort: High**

`agentComm` and the coordination control plane already enable peer messaging.
Layer in named **handoff** patterns (router → specialist, manager → workers)
and align the wire format with the emerging **Agent2Agent (A2A)** conventions
so SAM agents can interoperate with external agents.

- Touchpoints: extend `shared/coordination-types.ts` and
  `server/coordination/`; add handoff edges/affordances in the graph editor.

## 9. MCP spec currency — 🟡 Proposed

**Priority: Medium · Effort: Low-Medium**

Keep the MCP node aligned with the evolving spec: **elicitation** (servers
prompting the user mid-call), **sampling** (servers requesting a model
completion), resource subscriptions, and OAuth-based auth for HTTP/SSE
transports. The transport and tool-prefix plumbing already exists.

- Touchpoints: `server/` MCP client layer; extend `MCPNodeData` with auth +
  capability toggles.

---

## Suggested sequencing

1. **Evals** (this PR) → finish the runner + results panel.
2. **Observability** → traces make every other feature debuggable.
3. **Cost governor** → cheap to add given the existing cost metadata, high user value.
4. Then pick from structured outputs / RAG ingestion / triggers based on user demand.
