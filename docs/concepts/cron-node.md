# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-05 -->

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

The `cron` node type is in the default sidebar palette and its config
resolves fully through `graph-to-agent.ts`. **The scheduler itself is not
yet wired into the running server**, however: `CronScheduler`
(`server/scheduling/cron-scheduler.ts`) is a real, unit-tested class, but
nothing in `server/index.ts` or `server/agents/agent-manager.ts`
instantiates it or calls `.reconcile()` — see Runtime Behavior for what
is and isn't live today.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Cron Job"` | Display label shown on the node and in transcripts. |
| `schedule` | `string` | `"0 9 * * *"` | Standard 5-field cron expression. |
| `prompt` | `string` | `""` | The prompt the agent receives when the schedule fires. |
| `enabled` | `boolean` | `true` | When false, the schedule is parsed but never dispatched. |
| `sessionMode` | `"persistent" \| "ephemeral"` | `"persistent"` | Intended: `persistent` reuses a single session per cron node so context carries across ticks; `ephemeral` starts a fresh session every fire. **Not yet wired** — the scheduler always dispatches with a fixed `cron:<cronNodeId>` session key regardless of this value. |
| `timezone` | `string` | `"local"` | IANA timezone (e.g. `Europe/Berlin`) or `local` to use the server's timezone. |
| `maxRunDurationMs` | `number` | `300000` | Per-tick timeout. The run is aborted if it exceeds this. |
| `retentionDays` | `number` | `7` | Intended: how long the cron's transcripts are retained when storage maintenance runs. **Not yet wired** — no runtime code currently reads this field. |

Properties are derived from the TypeScript interface in
`src/types/nodes.ts` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`graph-to-agent.ts` resolves connected `cron` nodes into
`ResolvedCronConfig[]` on the `AgentConfig`. The
[`CronScheduler`](../../server/scheduling/cron-scheduler.ts) class is
built to reconcile the current schedule list against running jobs
whenever the agent config changes:

- New crons would get a `node-cron` job registered.
- Removed or disabled crons would get their job stopped.
- Each tick would call into the [`RunCoordinator`](../../server/agents/run-coordinator.ts)
  with the cron's `prompt` and a per-run timeout derived from
  `maxRunDurationMs`, dispatched with a fixed `sessionKey: cron:<cronNodeId>`.

**None of this runs today.** `CronScheduler` is exercised only by its own
unit test (`server/scheduling/cron-scheduler.test.ts`) — no server
startup path constructs one, so scheduled ticks never fire against a live
agent. Two fields also have no runtime effect yet even if the scheduler
were wired up:

- `sessionMode` is resolved into config but never branched on — every
  dispatch always uses the same `cron:<cronNodeId>` session key
  regardless of `persistent` vs `ephemeral`, so today's behavior is
  effectively always "persistent."
- `retentionDays` is resolved into config but not read anywhere;
  `server/scheduling/maintenance-scheduler.ts` prunes storage on its own
  schedule and has no cron-specific retention logic.

Treat this node as schema-only until `CronScheduler` is actually
instantiated from `server/index.ts` / `agent-manager.ts` — see
`CLAUDE.md`'s note that `cron` wiring should be verified in code before
being documented as fully implemented.

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
