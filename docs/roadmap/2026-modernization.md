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

## 2. Evaluations node — *proposed*

Eval-driven agent development is now table stakes (OpenAI Evals, Braintrust,
Promptfoo, LangSmith datasets). An `evals` node would hold a dataset of
input → expected pairs plus graders (exact-match, JSON-schema, LLM-as-judge,
tool-trajectory). A `sam eval` CLI command and a Settings panel would run the
suite against the resolved agent, score it, and track regressions across runs.

- New node `evals`, resolved `AgentConfig.evals`, engine `server/evals/eval-runner.ts`
- Reuses the existing run-coordinator to execute cases headlessly
- Pairs naturally with the Telemetry node for per-case cost/latency

## 3. Structured Output node — *scaffolded*

Constrain an agent's final response to a JSON Schema (OpenAI/Anthropic structured
outputs, tool-call-as-schema). The `structuredOutput` node carries a schema, a
strict/lenient mode, a provider response-format hint, and a failure policy
(repair / error / passthrough).

- Node: `structuredOutput` (`src/types/nodes.ts#StructuredOutputNodeData`)
- Resolved: `AgentConfig.structuredOutput` (`shared/agent-config.ts#ResolvedStructuredOutputConfig`)
- Engine: `server/runtime/structured-output-engine.ts` (dependency-free JSON
  Schema validator, JSON extraction, repair-prompt + provider-payload builders)
- Doc: `docs/concepts/structured-output-node.md`
- **Remaining:** wire `enforceFinalResponse` into the finalize step of
  `server/agents/run-coordinator.ts` (validate the final message, run the repair
  loop up to `maxRepairAttempts`, attach `responseFormatPayload` to the model
  request) and fold `buildSchemaPromptGuidance` into the system prompt.

## 4. Triggers node (event-driven beyond cron) — *proposed*

`cron` covers time. Modern agents also fire on webhooks, file changes, inbound
email, and queue messages. A `trigger` node would generalize the scheduler into
an event source registry (`webhook`, `fileWatch`, `queue`, `manual`), feeding the
same headless-run path the cron scheduler already uses
(`server/scheduling/`).

## 5. Budget / Rate-Governance node — *proposed*

A `budget` node enforcing spend and rate ceilings: max USD per session/day, max
tokens per run, max tool calls, and a degrade policy (downshift model, warn, or
hard-stop). Complements Guardrails (content safety) with cost safety. Consumes
the same price table as the Telemetry node.

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

---

## Sequencing

1. Finish wiring **Telemetry** (#1) — it is the measurement substrate the rest lean on.
2. Finish wiring **Structured Output** (#3) — scaffolded; integrate the finalize-step
   enforcement + repair loop next.
3. Land **Evals** (#2) on top of telemetry for cost-aware scoring.
4. **Budget** (#5) is small, high-value, independent.
5. **Triggers** (#4) and **Knowledge** (#6) are larger; schedule after the above.
6. **Prompt-cache** (#7) is an incremental agent-node enhancement, land opportunistically.
