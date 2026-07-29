# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-29 -->

## Overview

A `cron` node attaches a recurring schedule to an agent. When wired,
the intent is that the backend dispatches a run with a fixed prompt to
the connected agent on schedule — without any user message in the chat
drawer — so an agent can behave like a daemon: a daily summary, a
periodic ingestion, an hourly health check.

The schedule string follows standard cron syntax (`minute hour day month
weekday`) and is parsed by `node-cron`. Each cron node attached to an
agent is meant to run independently, so an agent can have several
schedules with different prompts.

`cron` is now part of the default sidebar palette (`src/panels/Sidebar.tsx`),
but that only means the node, its editor, and graph resolution are done.

> **Status:** the node, resolved config, and `CronScheduler`
> (`server/scheduling/cron-scheduler.ts`) are scaffolded and unit-tested,
> but nothing constructs a `CronScheduler` outside its own test file —
> `server/index.ts` never instantiates one. Wiring a cron node today
> updates `AgentConfig.crons`, but no tick is ever dispatched: there is
> no live schedule, no queued run, and no transcript entry. Treat this as
> an extension surface until server startup wires `CronScheduler` in.

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
`ResolvedCronConfig[]` on the `AgentConfig` — this part is live.

[`CronScheduler`](../../server/scheduling/cron-scheduler.ts) implements the
dispatch side and is covered by unit tests, but it is only ever
constructed in `cron-scheduler.test.ts`; no server startup path
instantiates it, so none of the following actually runs today. Once
wired, per its unit tests, it is designed to:

- reconcile the current schedule list against running jobs whenever the
  agent config changes — new crons get a `node-cron` job registered,
  removed or disabled crons get their job stopped;
- on each tick, call into the [`RunCoordinator`](../../server/agents/run-coordinator.ts)
  with the cron's `prompt` and `sessionMode`, and a per-run timeout
  derived from `maxRunDurationMs`.

`sessionMode: 'persistent'` keeps the cron's session-key stable across
ticks, so the agent's context engine and memory see one continuous
conversation. `sessionMode: 'ephemeral'` allocates a fresh session per
tick — useful when each run should be independent (cron-driven ingest,
report generation).

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
