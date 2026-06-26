# Structured Output Node

> Constrains an agent's final response to a JSON Schema, with strict/loose matching and a repair policy that re-prompts the model when validation fails.

<!-- source: src/types/nodes.ts#StructuredOutputNodeData -->
<!-- last-verified: 2026-06-26 -->

## Overview

The Structured Output node makes an agent's final answer machine-readable. It carries a JSON Schema, a strict/loose mode, and a policy for what to do when the model's response does not validate. It is inspired by the structured-output features in the Anthropic and OpenAI APIs (response schemas, tool-call-as-schema) and by validation-and-repair libraries like Instructor and Outlines.

At finalize time the runtime parses the agent's last message (handling bare JSON, ```json fences, and JSON embedded in prose), validates it against the schema, and — on failure — either re-prompts the model with the specific validation errors, passes the text through with the errors attached, or fails the run.

At most one Structured Output node applies to an agent; a single response cannot satisfy two schemas, so if several are connected the last resolved one wins.

> **Status:** the node, resolved config (`AgentConfig.outputSchema`), and engine (`server/runtime/structured-output-engine.ts`) are scaffolded and unit-tested. Wiring the enforcer into `server/agents/run-coordinator.ts` (validate the final message, re-run on `action === 'repair'`, surface errors otherwise) and injecting `structuredOutputPromptFragment()` into the system prompt are the remaining integration steps. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Structured Output"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but the response is unconstrained. |
| `schemaName` | `string` | `"response"` | Name surfaced to the model and used as the tool/span name. |
| `schemaText` | `string` | object with a required `answer` string | The JSON Schema as edited text. Parsed during graph resolution. |
| `strict` | `boolean` | `true` | Require an exact match (forbid extra properties even when `additionalProperties` is unset). Loose mode tolerates a superset. |
| `repairPolicy` | `'repair' \| 'passthrough' \| 'error'` | `'repair'` | What to do when validation fails. |
| `maxRepairAttempts` | `number` | `2` | Maximum re-prompt attempts when `repairPolicy` is `repair`. |
| `includeSchemaInPrompt` | `boolean` | `true` | Inject the schema into the system prompt so the model targets the shape up front. |

Properties are derived from `src/types/nodes.ts#StructuredOutputNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the connected Structured Output node into `AgentConfig.outputSchema` (`shared/agent-config.ts#ResolvedStructuredOutputConfig`). The `schemaText` is parsed at resolve time: valid JSON objects set `schema` and `schemaValid: true`; anything else resolves to `schema: null` / `schemaValid: false`, which disables enforcement.

`server/runtime/structured-output-engine.ts` provides the enforcement API:

- **`createEnforcer(config)`** — returns a `StructuredOutputEnforcer`. The enforcer is a no-op (`active === false`) when the node is disabled or its schema did not parse, so callers can enforce unconditionally.
- **`enforcer.enforce(responseText)`** — extracts JSON from the response, validates it, and returns an `EnforcementResult` whose `action` is `accept`, `repair` (with a `repairPrompt`), `error`, or `passthrough`. Calling `enforce` with a failing response consumes one repair attempt while `canRepair` holds.
- **`validateAgainstSchema(value, schema, strict)`** — a dependency-free JSON Schema validator covering a practical subset (`type`, `enum`, `const`, `properties`, `required`, `additionalProperties`, `items`, object/array/string/number bounds, `pattern`). It returns the full error list, not just the first failure.
- **`extractJson(text)`** — pulls a JSON value from a bare document, a fenced block, or surrounding prose (string-aware brace balancing).
- **`structuredOutputPromptFragment(config)`** — a system-prompt block describing the required schema, emitted only when `includeSchemaInPrompt` is set.

## Connections

Peripheral → Agent. At most one Structured Output node is effective per Agent (last connected wins).

## Example

```json
{
  "type": "structuredOutput",
  "label": "Ticket classifier",
  "enabled": true,
  "schemaName": "classification",
  "schemaText": "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"category\": { \"enum\": [\"bug\", \"feature\", \"question\"] },\n    \"priority\": { \"type\": \"integer\", \"minimum\": 1, \"maximum\": 5 }\n  },\n  \"required\": [\"category\", \"priority\"],\n  \"additionalProperties\": false\n}",
  "strict": true,
  "repairPolicy": "repair",
  "maxRepairAttempts": 2,
  "includeSchemaInPrompt": true
}
```
