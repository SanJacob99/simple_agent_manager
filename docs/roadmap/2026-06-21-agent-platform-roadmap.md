# Agent Platform Roadmap — keeping pace with fast-moving agent dev

<!-- last-verified: 2026-06-21 -->

This document proposes the next wave of node types and platform capabilities so
the builder keeps pace with where production agent development is heading in
2026. Each item is scoped as a peripheral node (attaches to an agent, never to
other peripherals) unless noted, and follows the established add-a-node pattern:
`src/types/nodes.ts` → `src/utils/default-nodes.ts` → node component +
`node-registry.ts` → `Sidebar.tsx` palette → `theme.ts`/`app.css` accent →
property editor + `PropertiesPanel.tsx` → `graph-to-agent.ts` resolution →
`shared/agent-config.ts` resolved shape → `docs/concepts/` doc + manifest.

## Shipped in this pass

### 1. Evaluation node ✅ (scaffolded)

Offline eval suites as a first-class graph object: a set of graded test cases
(input + reference/rubric) replayed against the agent and scored by a heuristic
or an LLM-as-judge. Schema, UI, resolution, and docs are wired; the server-side
eval **runner** is the remaining piece (replay each case, grade, emit a per-case
report). See `docs/concepts/evaluation-node.md`.

## Proposed next

### 2. Observability / Tracing node

A passive sink that exports per-run traces (spans for model calls, tool calls,
sub-agent hops) plus token/cost/latency to an OpenTelemetry-compatible backend
(Langfuse, Phoenix, OTLP collector). Config: exporter type, endpoint, headers,
sampling rate, redaction toggles, what to capture (prompts/completions/tool IO).
Highest-leverage gap: today there is no first-class way to ship structured
telemetry off the box. Pairs naturally with the Evaluation node (eval results
become traces).

### 3. Budget / Cost-governance node

Hard and soft ceilings on a run: max USD per run/session/day, max tokens, max
tool calls, max wall-clock. Actions on breach: `warn`, `pause-for-approval`,
`abort`. Mirrors the Guardrails node's structure (per-node resolved entry,
block/warn action) but on spend rather than content. Increasingly required for
autonomous/long-running agents.

### 4. Trigger / Webhook node

Event-driven entry points beyond Cron: inbound HTTP webhook, file-watch, queue
message, or a connector event (e.g. new GitHub issue, new email). Config:
trigger type, filter expression, auth/secret, payload-to-prompt template,
session mode. Turns the builder from "chat + schedule" into true event-driven
automation. Sibling of the existing `cron` node.

### 5. Structured-output / Schema node

Constrains the agent's final answer to a JSON Schema (or a small DSL) and
validates/repairs it before returning. Config: schema source (inline or file),
strict vs. best-effort, repair-retries, on-fail action. Enables the agent to be
used as a reliable component in a larger pipeline.

### 6. Knowledge / Document-ingestion node

Complements the existing `vectorDatabase` node by owning ingestion: source
(folder, URL list, connector), chunking strategy, embedding cadence, and refresh
schedule. Today the vector DB stores vectors but nothing on the canvas declares
*what gets indexed and how often*.

## Cross-cutting platform work

- **Run-report surface**: a unified panel for eval results, budget usage, and
  trace summaries (consumes nodes 1–3).
- **Node categories in the palette**: as the node count grows past ~16, group
  the sidebar (Core / Context / Tools / Safety & Quality / Triggers) instead of
  one flat list.
- **Settings defaults for new nodes**: wire `src/settings/` defaults for the
  Evaluation node (and successors) so teams can set org-wide judge models and
  thresholds.

## Sequencing recommendation

1. Evaluation **runner** (finish what is scaffolded) — immediate value.
2. Observability node — unblocks debugging everything else.
3. Budget node — safety rail for autonomous runs.
4. Trigger and Structured-output nodes — expand the automation surface.
5. Knowledge node + palette categorization — scale and polish.
