# Structured Output Node

> Constrains an agent's final response to a JSON Schema — validating the output, optionally re-prompting the model to repair violations, and surfacing a provider-side response-format hint.

<!-- source: src/types/nodes.ts#StructuredOutputNodeData -->
<!-- last-verified: 2026-06-25 -->

## Overview

The Structured Output node turns an agent's free-text final response into a typed, validated contract. It mirrors the structured-output features now standard across the ecosystem — OpenAI structured outputs / `response_format: json_schema`, Anthropic tool-schema enforcement, and the "tool-call-as-schema" pattern — so a graph can demand machine-readable output without bolting on a parsing step downstream.

When an agent finishes, the runtime extracts a JSON value from its final message, validates that value against the node's JSON Schema, and applies the configured failure policy: **repair** (re-prompt the model with the validation errors), **error** (fail the run), or **passthrough** (keep the raw text and flag it as unvalidated).

Unlike Telemetry and Guardrails — which resolve to arrays — an agent has a single final-response contract, so only one Structured Output node takes effect: the first connected, *enabled* node wins.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring `enforceFinalResponse` into the finalize step of `server/agents/run-coordinator.ts` (validate the final message, run the repair loop up to `maxRepairAttempts`, attach `responseFormatPayload` to the model request) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Structured Output"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but the final response is left unconstrained. |
| `schemaName` | `string` | `"response"` | Schema identifier surfaced to providers as the response-format name. |
| `schema` | `string` | sample object schema | JSON Schema source text. Parsed at resolve and finalize time. |
| `format` | `'json_schema' \| 'json_object' \| 'none'` | `'json_schema'` | Provider response-format hint. `none` validates client-side only. |
| `mode` | `'strict' \| 'lenient'` | `'strict'` | `strict` rejects unknown object keys (implies `additionalProperties: false`); `lenient` tolerates extras. |
| `onFailure` | `'repair' \| 'error' \| 'passthrough'` | `'repair'` | Behavior when the final response fails validation. |
| `maxRepairAttempts` | `number` | `2` | Max re-prompt attempts when `onFailure` is `repair`. |
| `includeSchemaInPrompt` | `boolean` | `true` | Append a compact rendering of the schema to the system prompt as guidance. |

Properties are derived from `src/types/nodes.ts#StructuredOutputNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the chosen Structured Output node into a single optional `ResolvedStructuredOutputConfig` on `AgentConfig.structuredOutput` (`shared/agent-config.ts`). The schema text is pre-parsed during resolution into `schemaJson`; if it does not parse, `schemaJson` is `null` and the runtime treats the node as advisory (prompt guidance only) rather than hard-enforcing an unparseable schema. Agents without a Structured Output node have `structuredOutput === undefined`.

`server/runtime/structured-output-engine.ts` provides the enforcement API (dependency-free — no `ajv`/`zod`):

- **`extractJson(message)`** — pulls a JSON value out of a free-form assistant message, trying the whole string, the first ```` ```json ```` fenced block, then the first balanced `{...}`/`[...]` span.
- **`validate(value, schema, strict)`** — a JSON Schema (Draft 2020-12 subset) validator covering `type`, `properties`, `required`, `additionalProperties`, `items`, `enum`, `const`, numeric bounds, string length/pattern, and array bounds. Unknown keywords are ignored, so richer schemas still validate on the understood subset.
- **`enforceFinalResponse(message, config)`** — the full pass: extract, then validate. A no-op (`ok: true`) when the node is disabled or the schema did not parse.
- **`buildRepairInstruction(errors, config)`** — a re-prompt string listing each validation error, fed back as a user turn under the `repair` policy.
- **`buildSchemaPromptGuidance(config)`** — the system-prompt addendum emitted when `includeSchemaInPrompt` is set.
- **`responseFormatPayload(config)`** — an OpenAI-compatible `response_format` object (`json_schema` / `json_object`), or `null` when no provider-side constraint is requested.

## Connections

Peripheral → Agent. Although multiple nodes can be connected, only one takes effect (the first connected, enabled node).

## Example

```json
{
  "type": "structuredOutput",
  "label": "Ticket classifier",
  "enabled": true,
  "schemaName": "classification",
  "schema": "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"category\": { \"type\": \"string\", \"enum\": [\"bug\", \"billing\", \"other\"] },\n    \"priority\": { \"type\": \"integer\", \"minimum\": 1, \"maximum\": 5 }\n  },\n  \"required\": [\"category\", \"priority\"],\n  \"additionalProperties\": false\n}",
  "format": "json_schema",
  "mode": "strict",
  "onFailure": "repair",
  "maxRepairAttempts": 2,
  "includeSchemaInPrompt": true
}
```
