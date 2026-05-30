# Guardrails Node

> Configurable input/output safety checks that block or warn before a turn reaches the model and after the assistant replies.

<!-- source: src/types/nodes.ts#GuardrailsNodeData -->
<!-- last-verified: 2026-05-30 -->

## Overview

The Guardrails node lets you attach configurable safety rules to an agent without changing the agent's prompt or tools. It is inspired by the input/output guardrail surfaces in OpenAI AgentKit, n8n, and Future-AGI: a thin pre/post check that lets operators enforce length limits, blocked terms, and PII rules without touching the model.

You can attach more than one Guardrails node to a single agent. The runtime evaluates them in graph order and the first `block` action wins; `warn` rules are recorded as `guardrail:violation` events on the run stream but do not abort the run. Guardrails are inherited by sub-agents that run on the same parent (`server/agents/sub-agent-executor.ts`).

When a `block` rule fires on input, the run is rejected before the user message is persisted to the transcript and before the model is called. The run finalizes with a `guardrail_blocked` `StructuredError` and the configured block message is added to the run payload, so the chat UI can render the refusal inline.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Guardrails"` | Human-readable label shown on the node and in violation events. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but the runtime skips its rules. |
| `checkInput` | `boolean` | `true` | Apply rules to user messages before they reach the model. |
| `checkOutput` | `boolean` | `true` | Apply rules to the assistant's reply after each turn. |
| `maxInputChars` | `number` | `8000` | Maximum length of a user message in characters. `0` disables the check. Input only. |
| `blockedTerms` | `string[]` | `[]` | Case-insensitive substrings that, if present, trigger the configured action. |
| `piiCategories` | `('email' \| 'ssn' \| 'credit_card')[]` | `[]` | Built-in PII regex categories to detect. |
| `action` | `'block' \| 'warn'` | `'block'` | Behavior when a rule matches. `block` aborts the run; `warn` only logs a violation event. |
| `blockMessage` | `string` | `""` | Message returned to the user when a `block` action fires. Empty falls back to a generic notice. |

Properties are derived from `src/types/nodes.ts#GuardrailsNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves each connected Guardrails node into a `ResolvedGuardrailConfig` entry on `AgentConfig.guardrails` (`shared/agent-config.ts`). The list is optional — agents without a Guardrails node have `guardrails === undefined` and the runtime short-circuits.

`server/runtime/guardrails-engine.ts` evaluates the rules:

- **`max_input_chars`** — input only, fires when `text.length > maxInputChars`.
- **`blocked_term`** — case-insensitive substring match against the message.
- **`pii_email` / `pii_ssn` / `pii_credit_card`** — regex patterns. The credit-card pattern is shape-only (no Luhn); pair with `warn` while tuning.

`server/agents/run-coordinator.ts#executeRun` runs the input check at the very top of the run's `try` block, before `persistUserMessage`. If a `block` violation fires, the run is finalized with a `guardrail_blocked` `StructuredError` and the block message is appended as an error payload. The output check runs after `runtime.prompt()` returns, against the streamed assistant text; because the reply has already streamed, output violations are reported as `guardrail:violation` stream events for audit but do not retroactively suppress the message.

Every violation (block or warn) is logged via `log('guardrails', …)` and emitted on the run's event stream as a `guardrail:violation` event with `{ guardrailNodeId, label, direction, rule, detail, action }`.

## Connections

Peripheral → Agent. Multiple Guardrails nodes may connect to a single Agent. Sub-Agent nodes inherit their parent's resolved guardrails when the run-coordinator builds the child config.

## Example

```json
{
  "type": "guardrails",
  "label": "Customer-support guardrail",
  "enabled": true,
  "checkInput": true,
  "checkOutput": true,
  "maxInputChars": 4000,
  "blockedTerms": ["password", "api key"],
  "piiCategories": ["email", "credit_card"],
  "action": "block",
  "blockMessage": "Please remove sensitive details and try again."
}
```
