# Budget Node

> Enforces spend and rate ceilings on an agent — max USD per session/day, max tokens and tool calls per run — with a warn / downshift / block enforcement policy.

<!-- source: src/types/nodes.ts#BudgetNodeData -->
<!-- last-verified: 2026-06-26 -->

## Overview

The Budget node adds cost safety alongside the Guardrails node's content safety. It declares ceilings on spend and activity and an action to take when one is reached. It mirrors the budget/quota controls now common in agent platforms (per-key spend caps, request and token rate limits, model fallback under pressure).

The runtime accumulates a run's token usage, USD cost (from the same per-1M-token price table the Telemetry node uses), and tool-call count, combines them with prior session/day spend supplied by the caller's accounting, and — before each turn and tool call — evaluates whether any ceiling is breached. The strongest enforcement among breached ceilings wins: `block` > `downshift` > `warn`.

You can attach more than one Budget node to a single agent (e.g. a soft per-run guard that warns and a hard daily cap that blocks). The runtime enforces the tightest active ceiling across all of them.

> **Status:** the node, resolved config (`AgentConfig.budgets`), and engine (`server/runtime/budget-engine.ts`) are scaffolded and unit-tested. Wiring the governor into `server/agents/run-coordinator.ts` (call `recordTurn` / `recordToolCall` as the run progresses, consult `evaluate()` before each step, and act on the decision — warn, swap to `fallbackModelId`, or stop the run) plus persisting session/day spend are the remaining integration steps. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Budget"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no ceilings are enforced. |
| `maxUsdPerSession` | `number` | `1` | Max USD spend per session. `0` disables this ceiling. |
| `maxUsdPerDay` | `number` | `10` | Max USD spend per UTC day across sessions. `0` disables this ceiling. |
| `maxTokensPerRun` | `number` | `0` | Max prompt + completion tokens per run. `0` disables. |
| `maxToolCallsPerRun` | `number` | `50` | Max tool invocations per run. `0` disables. |
| `enforcement` | `'warn' \| 'downshift' \| 'block'` | `'warn'` | Action taken when a ceiling is reached. |
| `fallbackModelId` | `string` | `""` | Cheaper model used when `enforcement` is `downshift`. |
| `warnThreshold` | `number` | `0.8` | Emit a warning once spend crosses this fraction (`0`–`1`) of any ceiling. |

Properties are derived from `src/types/nodes.ts#BudgetNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves each connected Budget node into a `ResolvedBudgetConfig` entry on `AgentConfig.budgets` (`shared/agent-config.ts`). The list is optional — agents without a Budget node have `budgets === undefined` and the runtime enforces nothing.

`server/runtime/budget-engine.ts` provides the governance API:

- **`createGovernor(configs, prices, spend)`** — returns a `BudgetGovernor`. It is a no-op (`active === false`) when no enabled config has any active (non-zero) ceiling. `prices` is the telemetry engine's `PriceTable`; `spend` carries `priorSessionUsd` / `priorDayUsd` from the caller's accounting.
- **`governor.recordTurn(modelId, usage)`** — adds tokens and derived USD cost for a completed model turn.
- **`governor.recordToolCall()`** — increments the per-run tool-call count.
- **`governor.evaluate()`** — returns a `BudgetDecision`: `status` (`ok` / `warn` / `exceeded`), the list of `breaches` and `warnings`, the strongest `enforcement`, and a `fallbackModelId` when downshifting. Pure — call it as often as needed.
- **`governor.shouldBlock()` / `governor.downshiftTarget()`** — convenience reads over `evaluate()`.
- **`describeBreach(breach)`** — a one-line, human-readable summary for logs and warnings.

Cost is computed from the injectable `PriceTable` (per-1M-token USD prices keyed by `modelId`); unknown models contribute `0`, so an unpriced model never trips a USD ceiling.

## Connections

Peripheral → Agent. Multiple Budget nodes may connect to a single Agent; the tightest active ceiling wins.

## Example

```json
{
  "type": "budget",
  "label": "Daily cap",
  "enabled": true,
  "maxUsdPerSession": 0.5,
  "maxUsdPerDay": 20,
  "maxTokensPerRun": 200000,
  "maxToolCallsPerRun": 40,
  "enforcement": "downshift",
  "fallbackModelId": "anthropic/claude-haiku-4-5",
  "warnThreshold": 0.75
}
```
