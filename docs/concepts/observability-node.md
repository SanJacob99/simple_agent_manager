# Observability Node

> Run-level tracing, token/cost accounting, and latency telemetry for an agent.

<!-- source: src/types/nodes.ts#ObservabilityNodeData -->
<!-- last-verified: 2026-06-20 -->

## Overview

The Observability node attaches telemetry to an agent. Once wired to an `agent`
node, it declares where trace spans should be shipped, what gets captured on
those spans (prompts, completions, tool I/O), and which run-level signals —
token usage, estimated cost, per-turn latency — the runtime should record. It
follows the [OpenTelemetry GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
so traces can land in any OTLP-compatible backend, with first-class options for
a local console exporter and Langfuse.

Use it when you want visibility into *why* a run behaved the way it did: which
tool calls fired, how many tokens each turn consumed, how much a session cost,
and where the slow turns are. Multiple Observability nodes can be attached to a
single agent; the runtime fans every span out to each enabled exporter, so you
can send the same trace to both a console (for local debugging) and a remote
collector (for dashboards) at once.

This node is an **extension surface**: the graph fully resolves it into
`AgentConfig.observability`, but the span-emission path in the run coordinator
is still being wired. Treat the exporter integrations as configuration intent
until verified end-to-end in code.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Observability"` | Display name on the canvas. |
| `enabled` | `boolean` | `true` | Master toggle. When off, the node is wired but emits no spans. |
| `exporter` | `'none' \| 'console' \| 'otlp' \| 'langfuse'` | `"console"` | Destination for emitted spans. |
| `endpoint` | `string` | `""` | OTLP/Langfuse endpoint URL. Empty falls back to the exporter default or env var. |
| `headers` | `Record<string, string>` | `{}` | Extra HTTP headers for the exporter (e.g. `Authorization`). Only used for `otlp`/`langfuse`. |
| `serviceName` | `string` | `"simple-agent-manager"` | The `service.name` resource attribute attached to every span. |
| `sampleRate` | `number` | `1` | Fraction of runs traced, `0`–`1`. `1` traces every run; `0.1` traces one in ten. |
| `capturePrompts` | `boolean` | `true` | Record the rendered prompt on LLM spans. |
| `captureCompletions` | `boolean` | `true` | Record the model completion text on LLM spans. |
| `captureToolIO` | `boolean` | `true` | Record tool-call arguments and results as span events. |
| `redactPii` | `boolean` | `false` | Strip emails/SSNs/credit-card-shaped numbers from captured text before export. |
| `trackCost` | `boolean` | `true` | Record token usage and an estimated cost per run as span attributes. |
| `latencyWarnMs` | `number` | `0` | Emit a `latency.warn` span event when a turn exceeds this many ms. `0` disables the check. |

Properties are derived from the TypeScript interface in `src/types/nodes.ts`
and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`resolveAgentConfig()` in `src/utils/graph-to-agent.ts` collects every connected
`observability` node into `AgentConfig.observability: ResolvedObservabilityConfig[]`
(`shared/agent-config.ts`). Each entry preserves the originating node id as
`observabilityNodeId` so emitted spans can be correlated back to the node that
produced them, and the `headers` map is shallow-copied so later canvas edits do
not mutate the resolved config.

The field is optional on `AgentConfig`, so existing serialized graphs and
fixtures remain compatible without a backfill. The run coordinator
(`server/agents/run-coordinator.ts`) is the intended consumer: when present and
`enabled`, it should open a root span per run, child spans per model turn and
tool call, and ship them to each configured exporter honoring `sampleRate`,
the capture toggles, `redactPii`, and `latencyWarnMs`. Until that path is
verified in code, treat runtime emission as **not yet fully implemented**.

## Connections

Like other peripheral nodes, the Observability node connects **to an `agent`
node only** (the edge points at the agent). It does not connect to other
peripheral nodes. An agent may have several Observability nodes attached.

## Example

A node that samples one run in five, ships OTLP spans to a collector with an
auth header, redacts PII, and warns on slow turns:

```json
{
  "type": "observability",
  "label": "Prod tracing",
  "enabled": true,
  "exporter": "otlp",
  "endpoint": "https://otlp.example.com/v1/traces",
  "headers": { "Authorization": "Bearer <token>" },
  "serviceName": "support-agent",
  "sampleRate": 0.2,
  "capturePrompts": true,
  "captureCompletions": true,
  "captureToolIO": true,
  "redactPii": true,
  "trackCost": true,
  "latencyWarnMs": 5000
}
```
