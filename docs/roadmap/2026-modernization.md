# Agent Manager Modernization Roadmap (2026 H2)

> A running proposal for keeping Simple Agent Manager current with the fast-moving
> agent ecosystem. Each item is sized as a node + resolved-config + engine slice
> that fits the existing graph → `AgentConfig` → runtime pattern, so they can land
> incrementally without a re-architecture.

Status legend: **scaffolded** (types/UI/engine landed, integration pending) ·
**proposed** (design only) · **wired** (end-to-end).

---

## 1. Telemetry / Observability node — *scaffolded*

Per-run, per-turn, and per-tool spans (tokens, cost, latency) exported to console,
file, or an OpenTelemetry/OTLP collector. Brings the builder in line with
LangSmith / Langfuse / Arize-style agent tracing and the OTel GenAI semantic
conventions.

- Node: `telemetry` (`src/types/nodes.ts#TelemetryNodeData`)
- Resolved: `AgentConfig.telemetry` (`shared/agent-config.ts#ResolvedTelemetryConfig`)
- Engine: `server/runtime/telemetry-engine.ts`
- Doc: `docs/concepts/telemetry-node.md`
- **Remaining:** wire `RunRecorder` into `server/agents/run-coordinator.ts` (open a
  turn span around `runtime.prompt()`, record tool spans, export on finalize) and
  surface a live cost/latency hint on the agent node.

## 2. Evaluations node — *scaffolded*

Eval-driven agent development is now table stakes (OpenAI Evals, Braintrust,
Promptfoo, LangSmith datasets). The `evals` node holds a dataset of
input → expected cases plus a grader per case (exact-match, contains, regex,
JSON-schema, LLM-as-judge). A `sam eval` CLI command and a Settings panel run
the suite against the resolved agent, score it, and track regressions across runs.

- Node: `evals` (`src/types/nodes.ts#EvalsNodeData`)
- Resolved: `AgentConfig.evals` (`shared/agent-config.ts#ResolvedEvalsConfig`)
- Engine: `server/evals/eval-runner.ts` (dependency-free graders + weighted
  `EvalRunner` with injected case executor / judge; the JSON-schema grader
  reuses the structured-output validator)
- Doc: `docs/concepts/evals-node.md`
- **Remaining:** wire `EvalRunner` into `server/agents/run-coordinator.ts` (replay
  each case as a headless ephemeral run, supply a real `JudgeFn`), add a `sam eval`
  subcommand, and surface a Settings evals panel with per-case cost/latency
  (pairs naturally with the Telemetry node).

## 3. Structured Output node — *scaffolded*

Constrain an agent's final response to a JSON Schema (OpenAI/Anthropic structured
outputs, tool-call-as-schema). The `structuredOutput` node carries a schema, a
strict/loose mode, and a repair policy (re-prompt on validation failure). It
resolves into `AgentConfig.outputSchema` and is enforced in the runtime's
finalize step.

- Node: `structuredOutput` (`src/types/nodes.ts#StructuredOutputNodeData`)
- Resolved: `AgentConfig.outputSchema` (`shared/agent-config.ts#ResolvedStructuredOutputConfig`)
- Engine: `server/runtime/structured-output-engine.ts` (dependency-free JSON-Schema validator)
- Doc: `docs/concepts/structured-output-node.md`
- **Remaining:** call `evaluateReply` in `server/agents/run-coordinator.ts`'s
  finalize step (repair/warn/block per policy) and add the native
  `response_format`/strict-tool path in `server/runtime/model-resolver.ts`.

## 4. Triggers node (event-driven beyond cron) — *proposed*

`cron` covers time. Modern agents also fire on webhooks, file changes, inbound
email, and queue messages. A `trigger` node would generalize the scheduler into
an event source registry (`webhook`, `fileWatch`, `queue`, `manual`), feeding the
same headless-run path the cron scheduler already uses
(`server/scheduling/`).

## 5. Budget / Rate-Governance node — *scaffolded*

The `budget` node enforces spend and rate ceilings: max USD per run/day, max
tokens per run, max tool calls per run, max runs per minute, and a degrade
policy (downshift model, warn, or hard-stop). Complements Guardrails (content
safety) with cost safety. Consumes the same price table as the Telemetry node.

- Node: `budget` (`src/types/nodes.ts#BudgetNodeData`)
- Resolved: `AgentConfig.budgets` (`shared/agent-config.ts#ResolvedBudgetConfig`)
- Engine: `server/runtime/budget-engine.ts` (`BudgetLedger` with rolling day/minute windows)
- Doc: `docs/concepts/budget-node.md`
- **Remaining:** own one `BudgetLedger` per agent in
  `server/agents/run-coordinator.ts` and apply each `BudgetDecision`
  (downshift the model, abort with `budget_exceeded`, or emit `budget:exceeded`).

## 6. Knowledge / Ingestion node — *proposed*

`vectorDatabase` provides the store; there is no first-class ingestion surface.
A `knowledge` node would own source definitions (files, URLs, git repos),
chunking strategy, embedding config, and a refresh schedule — turning raw
sources into vectors the context engine's RAG path already consumes.

## 7. Prompt-cache controls — *proposed (agent-node extension)*

Anthropic/OpenAI prompt caching meaningfully cuts cost and latency for agents
with large stable system prompts. Add cache-breakpoint controls to the Agent and
Context Engine nodes (mark system prompt / tool catalog / memory as cacheable),
resolved into the model request in `server/runtime/model-resolver.ts`.

## 8. Agent-to-Agent (A2A) interop node — *scaffolded*

`agentComm` is an in-process bus; `subAgent` is in-tree. Neither lets this agent
talk to agents built on *other* frameworks. The emerging Agent-to-Agent (A2A)
protocol (agent cards, task/message envelopes, streaming updates) is becoming
the lingua franca for cross-framework agent interop, much as MCP standardized
tools. The `a2a` node exposes this agent as an A2A server (publish an agent
card, accept remote tasks) and/or registers remote A2A agents as callable
delegates.

- Node: `a2a` (`src/types/nodes.ts#A2ANodeData`)
- Resolved: `AgentConfig.a2a` (`shared/agent-config.ts#ResolvedA2AConfig`)
- Engine: `server/a2a/a2a-engine.ts` (dependency-free: agent-card builder,
  JSON-RPC `message/send` envelope validation, remote-card parsing, delegate
  tool naming, inbound authorization, and a `TaskConcurrencyGuard`)
- Doc: `docs/concepts/a2a-node.md`
- **Remaining:** wire the server transport into `server/a2a/` (mount `serverPath`,
  serve the card at `/.well-known/agent-card.json`, gate inbound tasks with
  `authorizeInbound` + `TaskConcurrencyGuard`, dispatch to a headless run) and
  the client transport (fetch remote cards via `parseAgentCard`, register a
  delegate tool per `enabledRemotes` entry, post outbound tasks). Pairs with the
  Telemetry node (#1) — remote task spans slot into the same tracing surface.

## 9. Reflection / Self-critique node — *scaffolded*

Reflexion-style "draft → critique → revise" loops measurably lift answer quality
on hard tasks. The `reflection` node wraps the finalize step: after the agent
produces a candidate reply, a critic pass (same model or a cheaper one) scores it
against a rubric and, below a threshold, feeds the critique back for up to *N*
revisions. Pairs with the Evals node — the same rubric grades both.

- Node: `reflection` (`src/types/nodes.ts#ReflectionNodeData`)
- Resolved: `AgentConfig.reflection` (`shared/agent-config.ts#ResolvedReflectionConfig`)
- Engine: `server/runtime/reflection-engine.ts` (dependency-free prompt builders,
  critic-reply parsing, the revise decision, and the exhaustion policy; reuses
  `extractJson` from the structured-output engine)
- Doc: `docs/concepts/reflection-node.md`
- **Remaining:** run the critique/revise loop around `runtime.prompt()` in
  `server/agents/run-coordinator.ts`'s finalize step, resolve `criticModelId`
  through `server/runtime/model-resolver.ts`, and emit `reflection:revised` /
  `reflection:below_threshold` events. Pairs with the Evals node (#2), which can
  share the rubric.

## 10. Sandbox / Compute node — *proposed*

Agents that run code need isolation. A `sandbox` node would define an execution
environment (container/microVM/firecracker or a constrained local workdir), a
resource ceiling (CPU/mem/wall-clock), a network egress policy, and a filesystem
mount scope — resolved into `AgentConfig.sandbox` and consumed by the `exec` /
`code_execution` tools instead of today's raw `workspacePath`. Complements the
Budget node (cost safety) and Guardrails (content safety) with execution safety.

---

## Sequencing

1. Finish wiring **Telemetry** (#1) — it is the measurement substrate the rest lean on.
2. **Structured Output** (#3) and **Budget** (#5) are scaffolded — next is wiring
   both into the run-coordinator finalize/turn loop (see each item's *Remaining*).
3. **Evals** (#2) is scaffolded — wire `EvalRunner` into a headless replay path and
   add the `sam eval` subcommand; it pairs with Telemetry for cost-aware scoring and
   with **Reflection** (#9), which can share its rubric.
4. **Triggers** (#4) and **Knowledge** (#6) are larger; schedule after the above.
5. **Prompt-cache** (#7) is an incremental agent-node enhancement, land opportunistically.
6. **Reflection** (#9) is scaffolded — next is wiring the critique/revise loop
   into the run-coordinator finalize step; it shares a rubric with **Evals** (#2).
7. **A2A** (#8) is scaffolded — next is wiring the server/client transports in
   `server/a2a/` (see its *Remaining*); it pairs with Telemetry (#1) for remote
   task tracing. **Sandbox** (#10) is the next design wave — execution safety
   for code-running agents.
