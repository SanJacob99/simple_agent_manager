# Observability & Evals Node

> Captures runs as OpenTelemetry spans and scores them with lightweight evaluators.

<!-- source: src/types/nodes.ts#ObservabilityNodeData -->
<!-- last-verified: 2026-06-19 -->

## Overview

The Observability node is the graph's hook into the two things production agent
teams treat as table stakes in 2026: **tracing** (OpenTelemetry-native spans
following OpenInference conventions, so every LLM call, tool call, and handoff
lands in one trace) and **evals** (lightweight per-turn / per-session scoring
via LLM-as-judge rubrics or built-in heuristic checks).

Attach one Observability node to an agent. At most one is read per agent — the
first connected node wins. It is a sibling of the `guardrails` node: where
guardrails *enforce* input/output policy, observability *watches and scores* a
run without changing its behavior.

> **Status: scaffold.** This node is a fully wired configuration surface, but
> the runtime engine (`server/runtime/observability-engine.ts`) is a no-op by
> default and is not yet invoked by the run coordinator. It establishes the
> shape the coordinator will call into once tracing/eval wiring lands. See
> `docs/proposals/2026-06-19-feature-roadmap.md` (item 1) for the plan.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Observability"` | Display name on the canvas. |
| `enabled` | `boolean` | `true` | Master switch. When off, no spans are emitted and no evaluators run. |
| `tracingEnabled` | `boolean` | `true` | Emit a span per LLM/tool/handoff event. |
| `exporter` | `'none' \| 'console' \| 'otlp-http'` | `"console"` | Where spans go. `none` keeps them in-memory for the eval path; `console` logs them; `otlp-http` posts to a collector. |
| `otlpEndpoint` | `string` | `""` | OTLP/HTTP traces endpoint (e.g. `http://localhost:4318/v1/traces`). Used when `exporter === 'otlp-http'`. |
| `otlpHeaders` | `Record<string,string>` | `{}` | Extra headers for the OTLP exporter (e.g. `Authorization`). |
| `serviceName` | `string` | `""` | `service.name` resource attribute. Empty inherits the agent name. |
| `sampleRatio` | `number` | `1` | Head sampling ratio in `[0,1]`. `1` captures every run. |
| `redactPii` | `boolean` | `true` | Strip emails, SSNs, and credit-card-shaped numbers from span payloads before export (reuses the guardrail PII patterns). |
| `evalsEnabled` | `boolean` | `false` | Run the configured evaluators. |
| `evaluators` | `EvaluatorDefinition[]` | `[]` | Per-turn / per-session scorers. |

Each `EvaluatorDefinition`:

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Stable id. |
| `name` | `string` | Display name; appears in `eval:score` events. |
| `kind` | `'llm-judge' \| 'heuristic'` | Scoring method. |
| `scope` | `'turn' \| 'session'` | Run per turn or once at session end. |
| `rubric` | `string` | LLM-judge prompt. Ignored for heuristics. |
| `judgeModelId` | `string` | LLM-judge model. Empty inherits the agent model. |
| `heuristic` | `'non-empty' \| 'no-tool-errors' \| 'max-latency'` | Built-in check (no model call). Ignored for `llm-judge`. |
| `passThreshold` | `number` | Score in `[0,1]` at/above which the evaluator passes. |
| `enabled` | `boolean` | Per-evaluator toggle. |

Properties are derived from `src/types/nodes.ts#ObservabilityNodeData` and
defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`graph-to-agent.ts` resolves the first connected observability node into
`AgentConfig.observability` (`ResolvedObservabilityConfig | null`), an **optional**
field so existing fixtures and serialized graphs stay valid without a backfill.

`server/runtime/observability-engine.ts` exposes `ObservabilityEngine` with:

- `recordSpan(span)` — buffers a span, honoring `sampleRatio` and `redactPii`.
- `flush()` — exports buffered spans (`console` implemented; `otlp-http` is a
  documented TODO until the OpenTelemetry SDK dependency lands).
- `runEvaluators(scope, ctx)` — runs heuristics inline; `llm-judge` returns a
  neutral, non-passing score until the judge call is wired.

The run coordinator does **not** yet construct or invoke the engine, so today
the node has no effect on a live run.

## Connections

Connects **to an agent node only** (like `guardrails`, it is not in the
sub-agent peripheral allow-list). The edge marks the agent as observed.

## Example

```json
{
  "type": "observability",
  "label": "Observability",
  "enabled": true,
  "tracingEnabled": true,
  "exporter": "otlp-http",
  "otlpEndpoint": "http://localhost:4318/v1/traces",
  "otlpHeaders": { "Authorization": "Bearer ${OTEL_TOKEN}" },
  "serviceName": "support-agent",
  "sampleRatio": 1,
  "redactPii": true,
  "evalsEnabled": true,
  "evaluators": [
    {
      "id": "eval_quality",
      "name": "Answer quality",
      "kind": "llm-judge",
      "scope": "turn",
      "rubric": "Rate 0-1 how well the reply answered the user's question.",
      "judgeModelId": "",
      "heuristic": "non-empty",
      "passThreshold": 0.7,
      "enabled": true
    }
  ]
}
```
