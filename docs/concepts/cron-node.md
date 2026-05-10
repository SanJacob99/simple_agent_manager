# Cron Node

> Schedules an agent run on a recurring cron schedule, delivering a fixed prompt to the agent's session at each tick.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-05-10 -->

## Overview

The Cron Node lets you attach a scheduled trigger to an agent. At each scheduled tick the runtime delivers a prompt to the agent's dedicated cron session, triggering a full run just as if a user had sent that message. This is useful for recurring maintenance tasks, digest generation, watchdog checks, and any workflow that should fire on a fixed cadence rather than on demand.

Multiple Cron Nodes can be connected to a single Agent Node. Each node owns its own `node-cron` task and its own session (key shape: `cron:<cronNodeId>`), so concurrent schedules do not share conversation history.

The scheduler is managed by `server/scheduling/cron-scheduler.ts`, which is reconciled against the live `AgentConfig.crons` list whenever an agent is registered or its config changes. Jobs are started and stopped automatically as `enabled` flips or the schedule changes.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Cron Job"` | Display label on the canvas |
| `schedule` | `string` | `"0 9 * * *"` | Standard five-field cron expression (minute hour dom month dow). Parsed by `node-cron` |
| `prompt` | `string` | `""` | Text delivered to the agent's cron session at each tick |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the job is wired but never scheduled |
| `sessionMode` | `'persistent' \| 'ephemeral'` | `"persistent"` | `persistent` reuses the same cron session across ticks so the agent accumulates history; `ephemeral` is reserved for future use |
| `timezone` | `string` | `"local"` | IANA timezone for the schedule (e.g. `"America/New_York"`). The special value `"local"` inherits the server's system timezone |
| `maxRunDurationMs` | `number` | `300000` | Hard deadline in milliseconds. After this duration the scheduler aborts the run. `0` disables the deadline |
| `retentionDays` | `number` | `7` | How many days of cron session history to retain (informational; pruning is handled by the Storage Engine) |

Properties are derived from `src/types/nodes.ts#CronNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves each connected Cron Node into a `ResolvedCronConfig` entry on `AgentConfig.crons` (`shared/agent-config.ts`). The array is empty when no Cron Nodes are connected.

`server/scheduling/cron-scheduler.ts` manages the live jobs:

1. **`reconcile(agentId, crons)`** is called when an agent's config is (re-)registered. It stops any jobs no longer present or disabled, and starts new jobs for newly enabled entries. If the schedule or prompt of an existing job changes, the old task is stopped and a fresh one is started.
2. At each tick the scheduler calls `RunCoordinator.dispatch({ sessionKey: 'cron:<cronNodeId>', text: config.prompt })` to enqueue a run.
3. If `maxRunDurationMs > 0`, a `setTimeout` fires after the deadline and calls `coordinator.abort(runId)` to kill a long-running tick.
4. **Timezone**: the `timezone` field is passed directly to `node-cron`'s `timezone` option. When the value is `"local"`, `undefined` is passed instead, which makes `node-cron` use the server's process timezone.

The `CronScheduler` instance is a singleton created once and shared across all agents managed by the server.

## Connections

Peripheral → Agent. Multiple Cron Nodes may connect to a single Agent Node. Cron sessions are excluded from the normal session listing in the chat drawer and do not participate in sub-agent inheritance (see [Sub-Agent Node](sub-agent-node.md)).

## Example

```json
{
  "type": "cron",
  "label": "Daily Digest",
  "schedule": "0 8 * * 1-5",
  "prompt": "Summarize any open issues from yesterday and draft a brief status update.",
  "enabled": true,
  "sessionMode": "persistent",
  "timezone": "America/New_York",
  "maxRunDurationMs": 120000,
  "retentionDays": 14
}
```
