# Structured Output Node

> Constrains an agent's final response to a JSON Schema, then validates and optionally repairs the output.

<!-- source: src/types/nodes.ts#StructuredOutputNodeData -->
<!-- last-verified: 2026-06-24 -->

## Overview

The Structured Output node turns a free-form agent into one with a typed output contract. It carries a JSON Schema, a strategy for how that schema is applied to the model request, and a repair policy for what to do when the model's response doesn't conform. This mirrors the structured-output features now standard across providers — Anthropic and OpenAI constrained decoding, and the portable "tool-call-as-schema" pattern — so a graph can declare its output shape once and have the runtime enforce it.

Unlike most peripheral nodes, an agent has at most **one** output contract, so this node resolves to a single scalar value (`AgentConfig.outputSchema`) rather than a list. If more than one Structured Output node is connected, the first wins and the rest are ignored.

Use it when a downstream system consumes the agent's output programmatically (an API response, a workflow step, an extraction pipeline) and you need the result to be valid JSON of a known shape rather than prose.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the enforcer into `server/agents/run-coordinator.ts` (apply the strategy to the model request, evaluate the final response, and re-prompt with `buildRepairPrompt` when `repair === 'reprompt'`) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Structured Output"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but the response is left unconstrained. |
| `schemaName` | `string` | `"response"` | Identifier attached to the schema; used as the structured tool name or `response_format` name. |
| `schema` | `string` (JSON) | a `{ answer, confidence }` example object | The JSON Schema (draft 2020-12 subset) the final response must satisfy. Stored as text so the config stays serializable even when the schema is mid-edit. |
| `strict` | `boolean` | `true` | `strict` rejects output that fails validation; loose validates and warns but passes the output through. |
| `strategy` | `'tool' \| 'responseFormat' \| 'prompt'` | `'tool'` | How the constraint is applied — forced tool call (portable), native `response_format`/`json_schema`, or prompt guidance only. |
| `repair` | `'none' \| 'reprompt'` | `'reprompt'` | What to do when output fails validation. |
| `maxRepairAttempts` | `number` | `1` | Max re-prompt attempts when `repair` is `reprompt`. |
| `onFailure` | `'error' \| 'passthrough'` | `'error'` | Terminal behavior once repair is exhausted: surface an error or pass the raw text through. |

Properties are derived from `src/types/nodes.ts#StructuredOutputNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the connected Structured Output node into a `ResolvedStructuredOutputConfig` on `AgentConfig.outputSchema` (`shared/agent-config.ts`). The value is optional — agents without the node have `outputSchema === undefined` and the runtime constrains nothing.

`server/runtime/structured-output-engine.ts` provides the enforcement API (dependency-free, no JSON Schema library):

- **`parseSchema(text)`** — parses the raw schema text, reporting JSON/shape errors.
- **`validateAgainstSchema(value, schema)`** — validates a value against the supported draft 2020-12 subset (`type`, `properties`, `required`, `items`, `enum`, `const`, numeric and length bounds, `additionalProperties`, and `anyOf`/`allOf`/`oneOf`), accumulating every error.
- **`extractJson(text)`** — pulls the first JSON value out of a model response, handling bare JSON, ```json fences, and prose-wrapped balanced objects/arrays.
- **`buildRepairPrompt(name, errors, schemaText)`** — builds a corrective re-prompt naming the validation failures.
- **`createEnforcer(config)`** — returns a `StructuredOutputEnforcer`. Call `enforcer.evaluate(text)` with each candidate final response; it tracks repair attempts internally, so the caller loops while `decision.shouldRepair` is true. A disabled config yields a no-op pass-through enforcer (`active === false`).

The enforcer's `evaluate` returns `{ ok, value, errors, shouldRepair, repairPrompt, exhausted }`. In loose mode validation is advisory and never blocks finalization; in strict mode an invalid response triggers repair (up to `maxRepairAttempts`) and then resolves per `onFailure`.

## Connections

Peripheral → Agent. At most one Structured Output node is honored per Agent.

## Example

```json
{
  "type": "structuredOutput",
  "label": "Extraction contract",
  "enabled": true,
  "schemaName": "invoice",
  "schema": "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"total\": { \"type\": \"number\", \"minimum\": 0 },\n    \"currency\": { \"enum\": [\"USD\", \"EUR\", \"GBP\"] }\n  },\n  \"required\": [\"total\", \"currency\"],\n  \"additionalProperties\": false\n}",
  "strict": true,
  "strategy": "tool",
  "repair": "reprompt",
  "maxRepairAttempts": 2,
  "onFailure": "error"
}
```
