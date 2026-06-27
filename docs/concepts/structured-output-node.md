# Structured Output Node

> Constrains an agent's final response to a JSON Schema, validating the output and repairing it (re-prompt) when it does not conform.

<!-- source: src/types/nodes.ts#StructuredOutputNodeData -->
<!-- last-verified: 2026-06-27 -->

## Overview

The Structured Output node turns a free-form agent into one that returns machine-readable JSON. It carries a JSON Schema, a strictness mode, and a repair policy. This mirrors the structured-output / JSON-mode features now standard across providers (OpenAI Structured Outputs, Anthropic tool-as-schema, Gemini response schemas) and tooling like Instructor and BAML: declare the shape you want, and make the runtime responsible for getting the model to produce it.

At most one Structured Output node constrains a given agent — it describes a single output contract, not a set of independent instruments. The first connected node wins and resolves into `AgentConfig.outputSchema`; any extras are ignored. When no node is connected, `outputSchema` is omitted and the agent responds normally.

The node has two jobs. Before a run, it can inject the schema (and a "respond with JSON only" instruction) into the system prompt so the model aims at the right shape. After a run, it validates the model's final response against the schema and, when validation fails, applies the configured policy — re-prompt with the specific errors, pass the response through flagged as unvalidated, or fail the run.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the validator into the run-coordinator's finalize step (validate the assistant's final message, then apply `onValidationError`, and fold `buildSchemaInstruction()` into prompt assembly) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Structured Output"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but the schema is not enforced. |
| `schema` | `string` | example object schema | JSON Schema (draft-07 subset) the final response must satisfy, stored as raw JSON text. |
| `schemaName` | `string` | `"response"` | Name advertised to the model / used as the schema-as-tool name. |
| `mode` | `'strict' \| 'loose'` | `'strict'` | `strict` requires declared `required` fields and rejects undeclared properties when the schema sets `additionalProperties: false`; `loose` validates only the keywords present. |
| `onValidationError` | `'reprompt' \| 'passthrough' \| 'error'` | `'reprompt'` | What to do when validation fails. |
| `maxRepairAttempts` | `number` | `2` | Re-prompt attempts when `onValidationError` is `reprompt`. |
| `includeSchemaInPrompt` | `boolean` | `true` | Append the schema and an instruction to the system prompt so the model targets it. |

Properties are derived from `src/types/nodes.ts#StructuredOutputNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected Structured Output node into a single `ResolvedStructuredOutputConfig` on `AgentConfig.outputSchema` (`shared/agent-config.ts`). The field is optional — agents without the node have `outputSchema === undefined` and the runtime enforces nothing. The schema is kept as raw text so `AgentConfig` stays serializable and round-trips through import/export unchanged; the engine parses it lazily.

`server/runtime/structured-output-engine.ts` provides the enforcement API. It is dependency-free (no `ajv` / `@sinclair/typebox` at runtime) and implements the draft-07 subset the editor exposes (`type`, `required`, `properties`, `additionalProperties`, `items`, `enum`, `const`, `minimum`/`maximum`, `minLength`/`maxLength`, `minItems`/`maxItems`, `pattern`):

- **`parseSchema(config)`** — parses the raw schema text, returning a structured `{ schema, error }` rather than throwing, so a broken schema never crashes a run.
- **`extractJson(text)`** — pulls a JSON value out of a model response: whole-string JSON, a ```json fenced block, or the first balanced `{...}`/`[...]` embedded in prose (string- and escape-aware).
- **`validateOutput(config, responseText)`** — extracts JSON and walks the schema, returning `{ valid, value, errors, noJsonFound }`. In `loose` mode `additionalProperties: false` is not enforced.
- **`buildSchemaInstruction(config)`** — the system-prompt fragment added when `includeSchemaInPrompt` is set; returns `null` when disabled or the schema is unparseable (a broken schema must not corrupt the prompt).
- **`buildRepairPrompt(config, result)`** — the message fed back on a `reprompt` failure, listing each violation by JSON-pointer path.

Unknown schema keywords are ignored rather than rejected, so a schema using an unsupported keyword still validates on the keywords the engine understands.

## Connections

Peripheral → Agent. At most one Structured Output node constrains a single Agent; additional nodes are ignored.

## Example

```json
{
  "type": "structuredOutput",
  "label": "Triage result",
  "enabled": true,
  "schema": "{\n  \"type\": \"object\",\n  \"properties\": {\n    \"category\": { \"type\": \"string\", \"enum\": [\"bug\", \"feature\", \"question\"] },\n    \"priority\": { \"type\": \"integer\", \"minimum\": 1, \"maximum\": 5 },\n    \"summary\": { \"type\": \"string\", \"minLength\": 1 }\n  },\n  \"required\": [\"category\", \"priority\", \"summary\"],\n  \"additionalProperties\": false\n}",
  "schemaName": "triage",
  "mode": "strict",
  "onValidationError": "reprompt",
  "maxRepairAttempts": 2,
  "includeSchemaInPrompt": true
}
```
