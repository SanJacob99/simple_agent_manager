# Cron Node

> Schedules an agent to receive a prompt on a recurring cron schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-05-09 -->

## Overview

The Cron Node attaches to an Agent Node as a peripheral and triggers a run on the agent at the schedule you specify. At each tick the scheduler injects the node's `prompt` as a user message and dispatches it through the agent's normal run pipeline via `RunCoordinator`.

Each Cron Node is independent: multiple nodes can be attached to the same agent to create compound schedules (e.g. a daily summary at 09:00 and a weekly report on Mondays). The scheduler reconciles active jobs whenever the agent's config changes, stopping removed or disabled jobs and (re)starting updated ones.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Cron Job"` | Display label on the canvas |
| `schedule` | `string` | `"0 9 * * *"` | Cron expression (5-field, node-cron syntax). Example: `"0 9 * * *"` = 09:00 every day |
| `prompt` | `string` | `""` | Message sent to the agent at each tick |
| `enabled` | `boolean` | `true` | When false the job is stopped and skipped during reconcile |
| `sessionMode` | `'persistent' \| 'ephemeral'` | `'persistent'` | `persistent` reuses the agent's long-lived session; `ephemeral` creates a fresh session per tick |
| `timezone` | `string` | `"local"` | IANA timezone (e.g. `"America/New_York"`) or `"local"` to use the server's local time |
| `maxRunDurationMs` | `number` | `300000` | Abort the cron run if it exceeds this duration (5 minutes by default) |
| `retentionDays` | `number` | `7` | How many days of cron-run history to keep |

Properties are derived from the TypeScript interface in `src/types/nodes.ts` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

1. `resolveAgentConfig()` in `src/utils/graph-to-agent.ts` collects every connected Cron Node into `AgentConfig.crons: ResolvedCronConfig[]`, preserving the node id as `cronNodeId`.
2. `CronScheduler` (in `server/scheduling/cron-scheduler.ts`) receives the resolved list via `reconcile(agentId, crons)`. It stops removed or disabled jobs and starts new ones using `node-cron`.
3. At each tick `CronScheduler` calls `RunCoordinator.executeRun()` with the cron prompt as the user message and the `cronNodeId` for telemetry.
4. The `maxRunDurationMs` limit is enforced by `RunCoordinator` — if the run exceeds the budget the run is aborted.
5. Job status (scheduled, running, stopped) and `lastRunAt` / `nextRunAt` times are exposed via `CronScheduler.getStatus()` for the REST status endpoint.

## Connections

- **Sends to**: Agent Node only
- **Receives from**: None
- Multiple Cron Nodes may attach to one agent; each runs on its own independent schedule

## Example

```json
{
  "type": "cron",
  "label": "Daily Briefing",
  "schedule": "0 9 * * *",
  "prompt": "Generate a brief summary of today's priorities.",
  "enabled": true,
  "sessionMode": "persistent",
  "timezone": "America/New_York",
  "maxRunDurationMs": 300000,
  "retentionDays": 7
}
```
