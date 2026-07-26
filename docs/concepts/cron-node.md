# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-26 -->

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

Crons are real and part of the default sidebar palette. The scheduler,
the queueing path, and tests are in place — see Runtime Behavior.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Cron Job"` | Display label shown on the node and in transcripts. |
| `schedule` | `string` | `"0 9 * * *"` | Standard 5-field cron expression. |
| `prompt` | `string` | `""` | The prompt the agent receives when the schedule fires. |
| `enabled` | `boolean` | `true` | When false, the schedule is parsed but never dispatched. |
| `sessionMode` | `"persistent" \| "ephemeral"` | `"persistent"` | **Not read by the scheduler.** Every tick dispatches with the same fixed `cron:<cronNodeId>` session key regardless of this value, so behavior is always "persistent" today. See Runtime Behavior. |
| `timezone` | `string` | `"local"` | IANA timezone (e.g. `Europe/Berlin`) or `local` to use the server's timezone. |
| `maxRunDurationMs` | `number` | `300000` | Per-tick timeout. The run is aborted if it exceeds this. |
| `retentionDays` | `number` | `7` | How long the cron's transcripts are retained when storage maintenance runs. |

Properties are derived from the TypeScript interface in
`src/types/nodes.ts` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`graph-to-agent.ts` resolves connected `cron` nodes into
`ResolvedCronConfig[]` on the `AgentConfig`. The
[`CronScheduler`](../../server/scheduling/cron-scheduler.ts) reconciles
the current schedule list against running jobs whenever the agent config
changes:

- New crons get a `node-cron` job registered.
- Removed or disabled crons get their job stopped.
- Each tick calls `coordinator.dispatch()` with a fixed `sessionKey` of
  `cron:<cronNodeId>` and the cron's `prompt`
  (`server/scheduling/cron-scheduler.ts` `executeCronTick()`), plus a
  per-run timeout derived from `maxRunDurationMs`.

The `sessionMode` field on the node is resolved into `ResolvedCronConfig`
but `executeCronTick()` never reads it — the session key is always the
same fixed string per cron node, so ticks always land in one continuous
conversation (today's actual behavior matches `sessionMode: 'persistent'`
regardless of what's configured). `ephemeral` is defined in the type and
documented in the property editor but has no effect yet; treat it as
scaffolded until the scheduler is updated to branch on it.

`retentionDays` is read by the maintenance scheduler when present. The
storage engine's pruning behavior is partial today (see
[`docs/audit-2026-05-09.md`](../audit-2026-05-09.md) §2.5), so verify
end-to-end retention if your deployment depends on it.

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

A schema example for a throwaway hourly health probe. Note `sessionMode`
is currently ignored by the scheduler (see Runtime Behavior above), so
this tick still lands in the same `cron:<cronNodeId>` session as every
other tick, not a fresh one:

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
