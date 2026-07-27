# Telemetry Node

> Observability instrumentation that records per-run, per-turn, and per-tool spans — token usage, cost, and latency — and exports them to a console, file, or OpenTelemetry collector.

<!-- source: src/types/nodes.ts#TelemetryNodeData -->
<!-- last-verified: 2026-07-27 -->

## Overview

The Telemetry node attaches observability to an agent without changing its prompt or tools. It is inspired by the agent-tracing surfaces in LangSmith, Langfuse, Arize Phoenix, and the OpenTelemetry GenAI semantic conventions: a thin instrumentation layer that records what a run did and what it cost.

Each run produces a root span. Within it, the runtime can open a child span per model turn (token counts, cost estimate, latency) and a child span per tool call (name, duration, error). Completed run spans are fanned out to the configured exporter.

You can attach more than one Telemetry node to a single agent — for example a `console` instrument for local debugging and an `otlp` instrument shipping to a collector. Each resolves to its own entry and exports independently.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the recorder into `server/agents/run-coordinator.ts` (open a turn span around `runtime.prompt()`, record tool spans, export on finalize) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Telemetry"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no spans are emitted. |
| `captureTokens` | `boolean` | `true` | Record prompt/response token counts per turn. |
| `captureCost` | `boolean` | `true` | Derive a USD cost estimate from token counts and the model price table. |
| `captureLatency` | `boolean` | `true` | Record wall-clock latency per turn and per tool call. |
| `captureToolCalls` | `boolean` | `true` | Emit a child span for every tool invocation. |
| `exporter` | `'none' \| 'console' \| 'file' \| 'otlp'` | `'console'` | Destination for completed spans. |
| `otlpEndpoint` | `string` | `"http://localhost:4318/v1/traces"` | OTLP/HTTP collector endpoint (used when `exporter` is `otlp`). |
| `otlpHeaders` | `Record<string,string>` | `{}` | Extra headers for the OTLP request (e.g. `Authorization`). |
| `filePath` | `string` | `".sam/telemetry.jsonl"` | Newline-delimited JSON destination (used when `exporter` is `file`). Relative paths resolve to the workspace. |
| `serviceName` | `string` | `"simple-agent-manager"` | `service.name` resource attribute on every span. |
| `sampleRate` | `number` | `1` | Fraction of runs to record, `0`–`1`. |
| `redactContent` | `boolean` | `false` | Strip message/tool content from spans, keeping only counts and metadata. |

Properties are derived from `src/types/nodes.ts#TelemetryNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves each connected Telemetry node into a `ResolvedTelemetryConfig` entry on `AgentConfig.telemetry` (`shared/agent-config.ts`). `AgentConfig.telemetry` is always an array — agents without a Telemetry node resolve to `telemetry: []`, not `undefined`. The type is optional (`telemetry?: ResolvedTelemetryConfig[]`) for backward-compat with older fixtures, but `resolveAgentConfig()` always produces an array; an empty array means no spans are emitted.

`server/runtime/telemetry-engine.ts` provides the instrumentation API:

- **`createRunRecorder(config, runName, prices)`** — returns a `RunRecorder`. The recorder is a no-op when telemetry is disabled or the run falls outside `sampleRate`, so callers can instrument unconditionally and check `recorder.active`.
- **`recorder.startTurn(modelId)` / `recorder.endTurn(modelId, usage)`** — bracket a model turn; `endTurn` attaches token, cost, and latency attributes per the capture toggles.
- **`recorder.recordToolCall(name, durationMs, opts)`** — adds a tool span under the open turn (or the run root). `opts.input`/`opts.output` are omitted when `redactContent` is set.
- **`recorder.finish(status)`** — closes the run span and returns it.
- **`summarizeSpan(span)`** — flattens a span tree into `{ durationMs, inputTokens, outputTokens, costUsd, toolCalls }`.
- **`exportSpan(config, span, workspacePath)`** — fans the span out to the configured exporter. The `otlp` exporter emits OTLP/HTTP JSON directly (no SDK dependency); export failures are swallowed so telemetry never breaks a run.

Cost is computed from an injectable `PriceTable` (per-1M-token USD prices keyed by `modelId`); unknown models contribute `0`.

## Connections

Peripheral → Agent. Multiple Telemetry nodes may connect to a single Agent.

## Example

```json
{
  "type": "telemetry",
  "label": "Production tracing",
  "enabled": true,
  "captureTokens": true,
  "captureCost": true,
  "captureLatency": true,
  "captureToolCalls": true,
  "exporter": "otlp",
  "otlpEndpoint": "http://localhost:4318/v1/traces",
  "otlpHeaders": { "Authorization": "Bearer ${OTLP_TOKEN}" },
  "filePath": ".sam/telemetry.jsonl",
  "serviceName": "support-agent",
  "sampleRate": 0.25,
  "redactContent": true
}
```
