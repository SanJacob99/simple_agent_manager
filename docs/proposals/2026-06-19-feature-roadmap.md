<!-- last-verified: 2026-06-19 -->

# Feature Roadmap — Keeping Pace with Agent Development (2026 H2)

This document proposes net-new capabilities for Simple Agent Manager, grounded
in where the broader agent ecosystem is moving as of mid-2026. It is produced
by the recurring "propose & scaffold" routine. Each proposal lists the trend it
tracks, the gap in our current graph, and a concrete shape that fits our
node-based model and `AgentConfig` conventions.

Status legend: **Scaffolded** (skeleton landed in this PR), **Proposed**
(design only, not yet built).

---

## 1. Observability & Evals node — **Scaffolded**

**Trend.** Production agent teams in 2026 treat tracing + evals as table stakes.
Framework-agnostic, OpenTelemetry-native tracing (OpenInference semantic
conventions) captures every LLM call, tool call, and handoff as a span; the
same traces feed structured evaluations (LLM-as-judge, trace-level and
session-level scoring). Foundry, Arize Phoenix, Langfuse, and Braintrust all
converged on this OTel-based shape.

**Gap.** The graph has `guardrails` (input/output policy) but no surface for
*observing* a run or *scoring* its quality. Runs stream events and persist
transcripts, but there is no node to (a) export those events as OTel spans to
an external collector, or (b) attach lightweight evaluators that score a turn.

**Shape (this PR scaffolds the skeleton).** A peripheral `observability` node:

- **Tracing:** toggle span capture; pick an exporter (`none` | `console` |
  `otlp-http`); set an OTLP endpoint, headers, and a service name. Spans follow
  OpenInference conventions (`llm`, `tool`, `agent`, `chain` span kinds).
- **Sampling:** head sampling ratio so high-volume agents don't flood a
  collector.
- **Evals:** an optional list of evaluators (`llm-judge` with a rubric prompt,
  or `heuristic` like "response is non-empty" / "no tool errors"), each with a
  scope (`turn` | `session`) and a 0–1 pass threshold. Results emit as
  `eval:score` events and (when tracing is on) as span attributes.
- **Redaction:** reuse the guardrails PII categories to scrub span payloads
  before export.

The runtime engine (`server/runtime/observability-engine.ts`) is scaffolded as
a no-op-by-default class that the run coordinator can later wire into the event
stream — matching how `connectors`/`mcp` started as extension surfaces.

---

## 2. A2A (Agent2Agent) connector — **Proposed**

**Trend.** The agent-interop stack is consolidating into three layers: **MCP**
for agent→tool (97M downloads; adopted by Anthropic, OpenAI, Google, Microsoft),
**A2A** for agent→agent (donated to the Linux Foundation in 2025, 50+ launch
partners, 100+ enterprise supporters by early 2026), and WebMCP for web access.
A2A uses *Agent Cards* for capability discovery and built-in auth.

**Gap.** Our `agentComm` node is an *internal* bus between two agent nodes on
the same canvas. There is no way to call a remote A2A-speaking agent, nor to
expose one of our agents as an A2A endpoint.

**Shape.** Either extend `agentComm` with a `transport: 'internal' | 'a2a'`
discriminator, or add a dedicated `a2aConnector` node that holds a remote Agent
Card URL, auth, and capability allowlist — and optionally a "publish this agent
as an A2A server" toggle. Reuse the existing loop/turn/token safety controls.

---

## 3. MCP elicitation (structured human-in-the-loop) — **Proposed**

**Trend.** The 2026 MCP revisions added **elicitation**: a server can request
structured input from the user mid-call (with a JSON schema) instead of failing
on ambiguous input. This is a cleaner HITL primitive than free-text `ask_user`.

**Gap.** We have `ask_user` / `confirm_action` HITL tools and an `mcp` node, but
the MCP client path does not surface elicitation requests to the chat UI.

**Shape.** Add elicitation handling to the MCP client: when a server elicits,
render a schema-driven form in the chat drawer (reuse `property-editors/
schema-form`), collect the response, and return it to the server. No new node —
this is an `mcp`-node capability plus a chat-drawer surface.

---

## 4. Durable execution / checkpoint & resume — **Proposed**

**Trend.** Long-lived agents are converging on durable execution (Temporal,
Restate, LangGraph persistence, Azure Durable Task, Google ADK pause/resume).
A run checkpoints its state at decision points, can pause indefinitely (e.g.
awaiting human judgment), and resumes from the exact step after a crash or
restart — with idempotency keys on side-effecting tools to avoid double writes.

**Gap.** `run-coordinator` queues and streams runs and persists transcripts, but
a server restart loses in-flight run state; there is no resume-from-checkpoint.

**Shape.** Add a checkpoint store keyed by run id that snapshots message/tool
state after each step; on startup, the coordinator offers to resume incomplete
runs. Pairs naturally with HITL pauses. Likely a `storage`-node setting
(`durableRuns: boolean`) plus coordinator wiring rather than a new node.

---

## 5. Prompt/agent versioning & experiments — **Proposed**

**Trend.** Eval-driven development implies versioned prompts and A/B comparison
of agent configs against a fixed dataset, with regression gating in CI.

**Gap.** Graphs are import/export JSON snapshots; there is no first-class
version history or experiment comparison.

**Shape.** Builds on (1). A lightweight `experiments` view in the settings
workspace that runs two `AgentConfig` variants over a stored dataset and shows
per-evaluator score deltas. No new node; a settings section + the eval engine
from (1).

---

## Sequencing

(1) lands first because evals/observability is the highest-leverage gap and
unblocks (5). (3) is small and high-value. (2) and (4) are larger and should be
specced separately before implementation.
