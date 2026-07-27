# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-27 -->

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

The `CronScheduler` class (`server/scheduling/cron-scheduler.ts`) implements
the reconcile/dispatch logic described below and is unit-tested in
isolation, but it is **not currently instantiated anywhere in the running
server** — `server/index.ts`, `server/agents/agent-manager.ts`, and
`server/agents/run-coordinator.ts` have no references to `CronScheduler`,
and nothing calls `.reconcile()` when an agent config changes.
`AgentConfig.crons` is populated correctly by `graph-to-agent.ts`, but no
tick is ever dispatched at runtime today. Treat `cron` the same way
CLAUDE.md flags `connectors`, `vectorDatabase`, and `mcp`: schema and
engine are ready, product wiring is not — see Runtime Behavior.

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
`ResolvedCronConfig[]` on the `AgentConfig`. The
[`CronScheduler`](../../server/scheduling/cron-scheduler.ts) class
implements reconciliation of the current schedule list against running
jobs when invoked:

- New crons get a `node-cron` job registered.
- Removed or disabled crons get their job stopped.
- Each tick calls into the [`RunCoordinator`](../../server/agents/run-coordinator.ts)
  with the cron's `prompt` and `sessionMode`, and a per-run timeout
  derived from `maxRunDurationMs`.

**None of this runs today.** No production code path constructs a
`CronScheduler` or calls `reconcile()` on agent-config changes, so cron
nodes attached to a graph do not currently fire. The behavior above is
verified only by the class's own unit tests
(`server/scheduling/cron-scheduler.test.ts`), not by integration with the
live server.

`sessionMode: 'persistent'` keeps the cron's session-key stable across
ticks, so the agent's context engine and memory see one continuous
conversation. `sessionMode: 'ephemeral'` allocates a fresh session per
tick — useful when each run should be independent (cron-driven ingest,
report generation).

`retentionDays` is defined on the type and default-node factory but is
**not read by any runtime code today**. Neither
`server/storage/storage-engine.ts` nor any scheduling module references
it — the storage engine's `cleanResetArchives()` takes its own unrelated
retention parameter. Treat `retentionDays` as reserved for a future
maintenance pass, not an active setting.

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
