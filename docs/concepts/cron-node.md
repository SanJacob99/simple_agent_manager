# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-07 -->

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

`cron` is on the default sidebar palette and resolves into `AgentConfig`
like any other peripheral node. [`CronScheduler`](../../server/scheduling/cron-scheduler.ts)
itself is implemented and unit-tested, but nothing in the running server
constructs one or calls `reconcile()` — schedules are parsed and stored
in `AgentConfig.crons` and never actually fire. Treat this node as
scaffolded, not operational, until a `CronScheduler` instance is wired
into server startup; see Runtime Behavior for what is and isn't
connected today.

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
`ResolvedCronConfig[]` on the `AgentConfig`. That is as far as the wiring
goes today.

[`CronScheduler`](../../server/scheduling/cron-scheduler.ts) implements
the intended reconciliation loop — `reconcile(agentId, crons)` diffs the
desired schedule list against running `node-cron` jobs, starting new
ones, stopping removed/disabled ones, and dispatching each tick through
the [`RunCoordinator`](../../server/agents/run-coordinator.ts) with the
cron's `prompt` and a per-run timeout derived from `maxRunDurationMs` —
but **nothing in the running server constructs a `CronScheduler` or
calls `reconcile()`**. Outside its own test file, the class is never
instantiated. A configured `cron` node is therefore inert in production:
the schedule is stored in `AgentConfig.crons` but never fires.

Two configuration fields also have no runtime effect yet, independent of
the wiring gap above:

- `sessionMode` is resolved onto `ResolvedCronConfig` but every tick in
  `executeCronTick()` dispatches with the same fixed session key
  (`cron:<cronNodeId>`) regardless of its value — there is no branch for
  `ephemeral` allocating a fresh session.
- `retentionDays` is passed through to `ResolvedCronConfig` and otherwise
  unused. No maintenance code reads it; the only runtime retention field
  actually consumed by `StorageEngine.cleanResetArchives()` is the
  **storage** node's `resetArchiveRetentionDays` (a distinct field —
  see [storage-node.md](storage-node.md)).

Building the loop that instantiates `CronScheduler` at startup, wiring
`sessionMode`/`retentionDays` into that loop, and reconciling on agent
config changes is the remaining integration work.

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
