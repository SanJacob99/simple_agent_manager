# Structured Output Node

> Constrains an agent's final reply to a JSON Schema, with native provider enforcement, prompt injection, and a repair/warn/block policy on validation failure.

<!-- source: src/types/nodes.ts#StructuredOutputNodeData -->
<!-- last-verified: 2026-07-07 -->

## Overview

The Structured Output node makes an agent's final answer machine-readable. Instead of free-form prose, the reply is constrained to a JSON Schema you author on the node. It mirrors the structured-output surfaces in OpenAI (`response_format: json_schema`), Anthropic tool-call schemas, and the auto-fixing output parsers in LangChain / Instructor / BAML.

At most one Structured Output node binds to an agent — there can only be one shape for the final reply — so it resolves to a single optional value on `AgentConfig.outputSchema` rather than a list (unlike Guardrails or Telemetry). When `strict` is set, the schema is forwarded to providers that support native enforcement; regardless, the runtime validates the reply after the fact and applies the configured `onValidationError` policy.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring `evaluateReply` into `server/agents/run-coordinator.ts`'s finalize step (validate the streamed reply, then repair/warn/block) and the native `response_format` path in `server/runtime/model-resolver.ts` are the remaining integration steps. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Structured Output"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but the reply is unconstrained. |
| `schemaName` | `string` | `"response"` | Identifier sent to providers with native structured-output support. |
| `schema` | `string` | `{ answer: string }` object | The JSON Schema the reply must satisfy, stored as a JSON string so the graph stays serializable. |
| `strict` | `boolean` | `true` | Forward the schema to providers with native enforcement. When `false`, rely on prompt guidance plus post-hoc validation only. |
| `onValidationError` | `'repair' \| 'warn' \| 'block'` | `'repair'` | Behaviour when the reply fails validation. |
| `maxRepairAttempts` | `number` | `1` | Re-prompt rounds when `onValidationError` is `repair`. |
| `injectSchemaIntoPrompt` | `boolean` | `true` | Append the schema to the system prompt so models without native support still comply. |

Properties are derived from `src/types/nodes.ts#StructuredOutputNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected Structured Output node into a `ResolvedStructuredOutputConfig` on `AgentConfig.outputSchema` (`shared/agent-config.ts`). Agents without one have `outputSchema === null` and the runtime leaves the reply unconstrained.

`server/runtime/structured-output-engine.ts` provides the validation substrate (dependency-free — no `ajv`):

- **`parseSchema(raw)`** — parses the node's schema text; returns `null` for non-object schemas, which disables enforcement.
- **`extractJson(text)`** — pulls a JSON value out of a reply, tolerating Markdown code fences and surrounding prose.
- **`validateAgainstSchema(value, schema)`** — checks a value against a JSON Schema subset (type, properties, required, items, enum, additionalProperties, numeric/length/array bounds, anyOf/oneOf). Unknown keywords are ignored rather than rejected.
- **`buildSchemaPromptSection(config)`** — produces the system-prompt injection used when `injectSchemaIntoPrompt` is set.
- **`buildRepairPrompt(config, errors)`** — produces the re-prompt text used when `onValidationError` is `repair`.
- **`evaluateReply(config, reply)`** — the entry point the runtime calls in finalize; returns `{ status: 'ok', value }` or `{ status: 'invalid', errors, reason }`. Disabled configs and unparseable schemas yield `ok` (no enforcement).

## Connections

Peripheral → Agent. At most one Structured Output node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "structuredOutput",
  "label": "Ticket triage",
  "enabled": true,
  "schemaName": "triage",
  "schema": "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"priority\": { \"type\": \"string\", \"enum\": [\"low\", \"medium\", \"high\"] },\n    \"summary\": { \"type\": \"string\" }\n  },\n  \"required\": [\"priority\", \"summary\"],\n  \"additionalProperties\": false\n}",
  "strict": true,
  "onValidationError": "repair",
  "maxRepairAttempts": 2,
  "injectSchemaIntoPrompt": true
}
```
