# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-16 -->

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

> **Status:** the node, its config resolution, and the `CronScheduler` engine
> are implemented and unit-tested, but the engine is never instantiated by
> the running server — see Runtime Behavior. A configured cron does not fire
> today. Treat this as an extension surface, not a working feature.

The `cron` node is in the default sidebar palette (`src/panels/Sidebar.tsx`)
and resolves correctly into `AgentConfig.crons`. **However, the node is not
yet wired into the live backend.** `CronScheduler`
(`server/scheduling/cron-scheduler.ts`) is fully implemented and unit-tested,
but nothing in `server/index.ts`, `server/agents/agent-manager.ts`, or
`server/agents/run-coordinator.ts` ever constructs a `CronScheduler` or calls
its `reconcile()` method — the class is only exercised by its own test file.
Concretely: a configured, enabled cron node will never fire today. Treat this
as a scaffolded extension surface (see `CLAUDE.md`'s note that `cron` is
"ahead of product wiring") and verify wiring in code before relying on it.

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
`ResolvedCronConfig[]` on the `AgentConfig`. That resolution is the extent of
what runs today — nothing downstream currently reads `AgentConfig.crons` to
schedule anything.

[`CronScheduler`](../../server/scheduling/cron-scheduler.ts) is the engine
that *would* reconcile the schedule list against running jobs, and its
implementation shows the intended design:

- `reconcile(agentId, crons)` would register a `node-cron` job for new/enabled
  crons and stop jobs for removed or disabled ones.
- Each tick would call into [`RunCoordinator`](../../server/agents/run-coordinator.ts)
  with the cron's `prompt` and `sessionMode`, and a per-run timeout
  derived from `maxRunDurationMs`.
- `sessionMode: 'persistent'` would keep the cron's session-key stable across
  ticks, so the agent's context engine and memory see one continuous
  conversation. `sessionMode: 'ephemeral'` would allocate a fresh session per
  tick — useful when each run should be independent (cron-driven ingest,
  report generation).

**None of this is currently invoked.** No code outside
`cron-scheduler.test.ts` imports or instantiates `CronScheduler`, and
`reconcile()` is never called from `server/index.ts`, `agent-manager.ts`, or
`run-coordinator.ts`. Enabling a cron node on an agent today has no observable
effect — the schedule is stored in the resolved config and nothing else.

`retentionDays` is intended to be read by the maintenance scheduler once
wired. The storage engine's pruning behavior is partial today (see
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
