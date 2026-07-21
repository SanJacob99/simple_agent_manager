# Budget Node

> Enforces spend and rate ceilings on an agent — USD per run/day, tokens and tool calls per run, runs per minute — with a warn / downshift / block degrade policy.

<!-- source: src/types/nodes.ts#BudgetNodeData -->
<!-- last-verified: 2026-07-21 -->

## Overview

The Budget node adds cost safety to an agent, complementing the Guardrails node's content safety. It sets ceilings on estimated spend and request rate, and chooses what happens when one is reached: warn and continue, downshift to a cheaper model, or stop the run. This mirrors the spend-guard and rate-limit controls in platforms like Helicone, Portkey, and LiteLLM.

You can attach more than one Budget node to a single agent — for example a per-run token cap plus a per-day USD cap. Each is designed to resolve to its own envelope, enforced by a `BudgetLedger` where the strictest reached ceiling wins — but see Status below: this enforcement isn't wired into a live run yet. Cost is estimated from the same `PriceTable` (per-1M-token USD prices keyed by `modelId`) the Telemetry node consumes, so a single price source feeds both.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the `BudgetLedger` into `server/agents/run-coordinator.ts` (call `beginRun` on start, `recordUsage` after each turn, `recordToolCall` per tool, then apply the `BudgetDecision` — downshift the model, abort with a `budget_exceeded` error, or emit a `budget:exceeded` event) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Budget"` | Human-readable label shown on the node and in `budget:exceeded` events. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no ceilings are enforced. |
| `maxUsdPerRun` | `number` | `0` | Estimated USD spend ceiling per run. `0` disables this ceiling. |
| `maxUsdPerDay` | `number` | `0` | Estimated USD spend ceiling per rolling 24h window. `0` disables. |
| `maxTokensPerRun` | `number` | `0` | Prompt + completion token ceiling per run. `0` disables. |
| `maxToolCallsPerRun` | `number` | `0` | Tool invocation ceiling per run. `0` disables. |
| `maxRunsPerMinute` | `number` | `0` | Run start-rate ceiling per rolling minute. `0` disables. |
| `degradePolicy` | `'warn' \| 'downshift' \| 'block'` | `'warn'` | What happens when any ceiling is reached. |
| `downshiftModelId` | `string` | `""` | Model the run switches to under `downshift`. Empty degrades the policy to `warn`. |
| `blockMessage` | `string` | `""` | Message returned to the user when a `block` policy stops a run. Empty falls back to a generic notice. |

Properties are derived from `src/types/nodes.ts#BudgetNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves each connected Budget node into a `ResolvedBudgetConfig` entry on `AgentConfig.budgets` (`shared/agent-config.ts`). The list is optional — agents without a Budget node have `budgets === undefined` and the runtime enforces no ceilings.

`server/runtime/budget-engine.ts` provides the `BudgetLedger` class. The runtime owns one ledger per agent (long-lived, so the per-day and per-minute rolling windows persist across runs):

- **`beginRun(runId, now)`** — registers a run start and enforces `maxRunsPerMinute`.
- **`recordUsage(runId, modelId, usage, now)`** — accrues tokens and USD cost for a turn, then re-checks the run ceilings.
- **`recordToolCall(runId)`** — accrues one tool call and re-checks `maxToolCallsPerRun`.
- **`endRun(runId)`** — drops per-run accounting; the rolling windows are retained.

Each call returns a `BudgetDecision` — `{ ok, action, violations, downshiftModelId }`. The `action` is the strictest implied by the violations (`block` > `downshift` > `warn`); a `downshift` policy with no configured model degrades to `warn`. Rolling windows are computed from caller-supplied timestamps, so the ledger is deterministic and testable without touching the clock.

## Connections

Peripheral → Agent. Multiple Budget nodes may connect to a single Agent; all are enforced.

## Example

```json
{
  "type": "budget",
  "label": "Daily spend cap",
  "enabled": true,
  "maxUsdPerRun": 0.5,
  "maxUsdPerDay": 25,
  "maxTokensPerRun": 200000,
  "maxToolCallsPerRun": 40,
  "maxRunsPerMinute": 10,
  "degradePolicy": "downshift",
  "downshiftModelId": "anthropic/claude-haiku-4-5-20251001",
  "blockMessage": ""
}
```
