# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-18 -->

## Overview

A `cron` node attaches a recurring schedule to an agent. When the schedule
fires, the backend dispatches a run with a fixed prompt to the connected
agent — without any user message in the chat drawer. This lets an agent
behave like a daemon: a daily summary, a periodic ingestion, an hourly
health check.

The schedule string follows standard cron syntax (`minute hour day month
weekday`) and is parsed by `node-cron`. Each cron node attached to an
agent runs independently, so an agent can have several schedules with
different prompts.

> **Status:** the node type, resolution into `AgentConfig.crons`, and the
> [`CronScheduler`](../../server/scheduling/cron-scheduler.ts) class are
> implemented and unit-tested, but `CronScheduler` has no production call
> site — nothing in `server/agents/agent-manager.ts` or `server/index.ts`
> ever constructs it or calls `.reconcile()`. A cron node resolves cleanly
> into config today, but schedules never actually fire in the running app.
> Wiring the scheduler into agent start/restore is the remaining
> integration step; treat this as an extension surface until that path is
> verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Cron Job"` | Display label shown on the node and in transcripts. |
| `schedule` | `string` | `"0 9 * * *"` | Standard 5-field cron expression. |
| `prompt` | `string` | `""` | The prompt the agent receives when the schedule fires. |
| `enabled` | `boolean` | `true` | When false, the schedule is parsed but never dispatched. |
| `sessionMode` | `"persistent" \| "ephemeral"` | `"persistent"` | `persistent` reuses a single session per cron node so context carries across ticks. `ephemeral` starts a fresh session every fire. |
| `timezone` | `string` | `"local"` | IANA timezone (e.g. `Europe/Berlin`) or `local` to use the server's timezone. |
| `maxRunDurationMs` | `number` | `300000` | Per-tick timeout. The run is aborted if it exceeds this. |
| `retentionDays` | `number` | `7` | How long the cron's transcripts are retained when storage maintenance runs. |

Properties are derived from the TypeScript interface in
`src/types/nodes.ts` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`graph-to-agent.ts` resolves connected `cron` nodes into
`ResolvedCronConfig[]` on the `AgentConfig`. That resolved list is inert
data today: nothing in the running server reads `AgentConfig.crons` to
schedule anything.

[`CronScheduler`](../../server/scheduling/cron-scheduler.ts) implements
the intended reconcile loop — and is fully unit-tested against that
intent — but it is only ever constructed inside
`cron-scheduler.test.ts`. As designed (not yet wired into the running
app), it would:

- Register a `node-cron` job for each new cron.
- Stop the job for any cron that's removed or disabled.
- On each tick, call into the [`RunCoordinator`](../../server/agents/run-coordinator.ts)
  with the cron's `prompt` and `sessionMode`, and a per-run timeout
  derived from `maxRunDurationMs`.

`sessionMode: 'persistent'` vs. `'ephemeral'` and the `retentionDays`
field describe the same intended behavior — one continuous session
across ticks vs. a fresh session per tick, and how long the maintenance
scheduler should keep the cron's transcripts. Like `CronScheduler`,
[`MaintenanceScheduler`](../../server/scheduling/maintenance-scheduler.ts)
is implemented and unit-tested but never constructed outside its own
test file, and `retentionDays` itself is not read anywhere in
production code (`grep -rn "retentionDays" server/` only matches the
test fixture). The storage engine does prune reset archives via
`cleanResetArchives()`, but that path is driven by the storage node's
own `resetArchiveRetentionDays`, not by any cron node's `retentionDays`.

Until agent start/restore actually constructs `CronScheduler` (and
`MaintenanceScheduler`), treat `schedule`, `sessionMode`,
`maxRunDurationMs`, and `retentionDays` as configuration that is saved
and resolved correctly but not yet acted on.

## Connections

`cron` nodes connect to `agent` nodes only. Multiple cron nodes can
connect to the same agent and run independently. Crons do not connect
to other peripheral nodes.

## Example

A cron that asks the agent for a daily 9am summary, persisted across
days so the agent can reference yesterday's report:

```json
{
  "type": "cron",
  "label": "Daily standup",
  "schedule": "0 9 * * 1-5",
  "prompt": "Summarize what changed in the repo since yesterday's standup. Mention open PRs and pinned issues.",
  "enabled": true,
  "sessionMode": "persistent",
  "timezone": "Europe/Berlin",
  "maxRunDurationMs": 120000,
  "retentionDays": 30
}
```

A throwaway hourly health probe with no shared context:

```json
{
  "type": "cron",
  "label": "Hourly probe",
  "schedule": "0 * * * *",
  "prompt": "Run the smoke test plan and report any non-200 responses.",
  "enabled": true,
  "sessionMode": "ephemeral",
  "timezone": "local",
  "maxRunDurationMs": 60000,
  "retentionDays": 3
}
```
