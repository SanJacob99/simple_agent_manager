# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-22 -->

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

Crons are real but kept off the default sidebar palette in some earlier
builds because the runtime was being verified end-to-end. The scheduler,
the queueing path, and tests are now in place — see Runtime Behavior.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Cron Job"` | Display label shown on the node and in transcripts. |
| `schedule` | `string` | `"0 9 * * *"` | Standard 5-field cron expression. |
| `prompt` | `string` | `""` | The prompt the agent receives when the schedule fires. |
| `enabled` | `boolean` | `true` | When false, the schedule is parsed but never dispatched. |
| `sessionMode` | `"persistent" \| "ephemeral"` | `"persistent"` | Intended to select whether ticks share one session or each gets a fresh one. **Currently inert at runtime** — see Runtime Behavior. |
| `timezone` | `string` | `"local"` | IANA timezone (e.g. `Europe/Berlin`) or `local` to use the server's timezone. |
| `maxRunDurationMs` | `number` | `300000` | Per-tick timeout. The run is aborted if it exceeds this. |
| `retentionDays` | `number` | `7` | Intended retention window for the cron's transcripts. **Currently unused** — see Runtime Behavior. |

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
- Each tick calls `RunCoordinator.dispatch({ sessionKey, text })`
  (`cron-scheduler.ts`'s `executeCronTick()`), then arms a per-run timeout
  derived from `maxRunDurationMs` that aborts the run if it fires.

`sessionMode` is defined on `ResolvedCronConfig` but `executeCronTick()`
always dispatches with the same `sessionKey: cron:<cronNodeId>` regardless
of its value — `dispatch()` is never passed `sessionMode`, and nothing in
`cron-scheduler.ts` or `run-coordinator.ts` branches on it. Every tick
today behaves like `persistent` (one continuous session per cron node);
`ephemeral` is not implemented yet.

`retentionDays` flows into `ResolvedCronConfig` but is not read by any
runtime code. Storage's own transcript/reset-archive pruning is driven by
the Storage node's `resetArchiveRetentionDays` field
(`server/storage/storage-engine.ts`'s `cleanResetArchives()`), which is
unrelated to this field. Treat `retentionDays` as reserved for now.

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
