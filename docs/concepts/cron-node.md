# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-03 -->

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

> **Status:** `CronScheduler` is a complete, unit-tested class, but it is
> not currently instantiated anywhere in `server/index.ts` or
> `server/agents/agent-manager.ts`, and `AgentConfig.crons` is never read
> outside its own tests. Wiring a cron node today produces config data
> but has **no live effect** — schedules never fire. Treat this as an
> extension surface until a live entry point calls `CronScheduler.reconcile()`.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Cron Job"` | Display label shown on the node and in transcripts. |
| `schedule` | `string` | `"0 9 * * *"` | Standard 5-field cron expression. |
| `prompt` | `string` | `""` | The prompt the agent receives when the schedule fires. |
| `enabled` | `boolean` | `true` | When false, the schedule is never registered — the cron is skipped entirely, not parsed-then-suppressed. |
| `sessionMode` | `"persistent" \| "ephemeral"` | `"persistent"` | Schema-only today: `CronScheduler.executeCronTick()` always dispatches with a hardcoded `cron:<cronNodeId>` session key and never reads this field. Documented intent below is aspirational until it's wired up. |
| `timezone` | `string` | `"local"` | IANA timezone (e.g. `Europe/Berlin`) or `local` to use the server's timezone. |
| `maxRunDurationMs` | `number` | `300000` | Per-tick timeout. The run is aborted if it exceeds this. |
| `retentionDays` | `number` | `7` | Schema-only today: not read by `CronScheduler` or the maintenance scheduler outside tests. |

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
- Each tick calls into the [`RunCoordinator`](../../server/agents/run-coordinator.ts)
  with the cron's `prompt` and `sessionMode`, and a per-run timeout
  derived from `maxRunDurationMs`.

`sessionMode` and `retentionDays` are defined on the schema and type but
not currently consumed by `CronScheduler` (see the Status callout above
and the Configuration table). Every tick uses the same fixed session key
regardless of `sessionMode`, and nothing reads `retentionDays`.

## Connections

`cron` nodes connect to `agent` nodes only. Multiple cron nodes can
connect to the same agent and run independently. Crons do not connect
to other peripheral nodes.

Workspace-level cron defaults can be set in Settings → Defaults → Cron;
new cron nodes inherit those overrides at creation time.

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
