# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-12 -->

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

> **Status:** the node, schema resolution, and the standalone
> [`CronScheduler`](../../server/scheduling/cron-scheduler.ts) class are
> implemented and unit-tested, but nothing in `server/index.ts` or
> `AgentManager` constructs a `CronScheduler` or calls `.reconcile()` — a
> configured cron node does not currently register a job or fire in the
> running server. Treat this node as schema-ahead-of-wiring (see
> `CLAUDE.md`) until that integration lands.

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
`ResolvedCronConfig[]` on the `AgentConfig`. Nothing currently consumes
that list at runtime — see the Status note above.

If/when a `CronScheduler` is constructed and wired to an agent's
coordinator, `reconcile(agentId, crons)` would keep `node-cron` jobs in
sync with the resolved config:

- New crons get a `node-cron` job registered.
- Removed or disabled crons get their job stopped.
- Each tick calls into the [`RunCoordinator`](../../server/agents/run-coordinator.ts)
  with the cron's `prompt` on session key `cron:<cronNodeId>`, and sets a
  `setTimeout` to `coordinator.abort()` the run after `maxRunDurationMs`.

Two fields on the resolved config are not yet read by
`CronScheduler.executeCronTick`, despite being present on
`ResolvedCronConfig` and settable from the node's property editor:

- `sessionMode` — the scheduler always dispatches on the same
  `cron:<cronNodeId>` session key; there is no branch for `'ephemeral'`
  that would allocate a fresh session per tick.
- `retentionDays` — no maintenance path currently reads this field. The
  storage engine has a separate, unrelated `cleanResetArchives(retentionDays, dryRun)`
  method for reset-archive pruning (see
  [`docs/audit-2026-05-09.md`](../audit-2026-05-09.md) §2.5); it is not
  cron-transcript-specific.

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
