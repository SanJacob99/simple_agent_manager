# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-17 -->

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

Cron nodes are on the default sidebar palette. The `CronScheduler` class
that reconciles schedules and dispatches ticks is fully implemented and
unit-tested (`server/scheduling/cron-scheduler.ts`), but it is **not
currently instantiated anywhere in the running server** — `grep -rn "new
CronScheduler"` across the repo only turns up its own test file. Until
something constructs a `CronScheduler` at startup (e.g. in
`server/index.ts` or `agent-manager.ts`), a cron node's schedule is
resolved into config but never actually dispatches a run. Treat cron as
schema-complete and engine-tested, not yet wired end-to-end — verify the
wiring in code before relying on it in a deployment.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Cron Job"` | Display label shown on the node and in transcripts. |
| `schedule` | `string` | `"0 9 * * *"` | Standard 5-field cron expression. |
| `prompt` | `string` | `""` | The prompt the agent receives when the schedule fires. |
| `enabled` | `boolean` | `true` | When false, the schedule is parsed but never dispatched. |
| `sessionMode` | `"persistent" \| "ephemeral"` | `"persistent"` | **Not read by any runtime code today** — see Runtime Behavior. Resolves into `ResolvedCronConfig.sessionMode` but every tick dispatches with the same fixed session key regardless of this value. |
| `timezone` | `string` | `"local"` | IANA timezone (e.g. `Europe/Berlin`) or `local` to use the server's timezone. |
| `maxRunDurationMs` | `number` | `300000` | Per-tick timeout. The run is aborted if it exceeds this. |
| `retentionDays` | `number` | `7` | **Not read by any runtime code today** — see Runtime Behavior. Resolves into `ResolvedCronConfig.retentionDays` but nothing consumes it. |

Properties are derived from the TypeScript interface in
`src/types/nodes.ts` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`graph-to-agent.ts` resolves connected `cron` nodes into
`ResolvedCronConfig[]` on the `AgentConfig`. The
[`CronScheduler`](../../server/scheduling/cron-scheduler.ts) class, when
constructed, reconciles the current schedule list against running jobs
whenever the agent config changes:

- New crons get a `node-cron` job registered.
- Removed or disabled crons get their job stopped.
- Each tick (`executeCronTick`) calls into the
  [`RunCoordinator`](../../server/agents/run-coordinator.ts) with the
  cron's `prompt` and a per-run timeout derived from `maxRunDurationMs`,
  dispatching against a fixed session key of shape `cron:<cronNodeId>`.

**However, `CronScheduler` is never instantiated outside its own test
suite** (`cron-scheduler.test.ts`) — it is not wired up in
`server/index.ts` or `server/agents/agent-manager.ts`, so no cron
currently fires in the running application. Verify this in code before
depending on cron dispatch in a deployment.

Two configuration fields are schema-only and have no effect even once
the scheduler is wired up, because nothing in the current codebase reads
them:

- `sessionMode` — `executeCronTick` always dispatches with the same
  fixed session key (`cron:<cronNodeId>`) regardless of this value.
  There is no branch for `ephemeral` behavior anywhere in
  `SessionRouter` or `RunCoordinator`; every tick behaves as
  `persistent`.
- `retentionDays` — resolved onto `ResolvedCronConfig` but never read.
  The storage engine's `runMaintenance()` only consults the connected
  Storage Node's own retention fields (`pruneAfterDays`,
  `resetArchiveRetentionDays`, etc. — see
  [storage-node.md](storage-node.md)), not a cron's `retentionDays`.

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
