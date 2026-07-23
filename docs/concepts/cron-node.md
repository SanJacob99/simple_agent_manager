# Cron Node

> Time-triggered agent runs on a configurable schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-07-23 -->

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
| `sessionMode` | `"persistent" \| "ephemeral"` | `"persistent"` | Resolved onto `ResolvedCronConfig` but **not currently read by `CronScheduler`**: every tick dispatches with the same `cron:<cronNodeId>` session key regardless of mode, so `ephemeral` behaves identically to `persistent` today. See Runtime Behavior. |
| `timezone` | `string` | `"local"` | IANA timezone (e.g. `Europe/Berlin`) or `local` to use the server's timezone. |
| `maxRunDurationMs` | `number` | `300000` | Per-tick timeout. The run is aborted if it exceeds this. |
| `retentionDays` | `number` | `7` | Resolved onto `ResolvedCronConfig` but **not currently read by any runtime code** — no storage-maintenance path consumes a cron node's `retentionDays` today. |

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
  with the cron's `prompt` and a hardcoded `sessionKey: cron:<cronNodeId>`,
  plus a per-run timeout derived from `maxRunDurationMs`.

`sessionMode` is schema-only right now: `server/scheduling/cron-scheduler.ts`
never reads `config.sessionMode` and always dispatches with the same
`cron:<cronNodeId>` session key, so every tick behaves like `'persistent'`
(the agent's context engine and memory see one continuous conversation
across fires) even when the node is set to `'ephemeral'`. Wiring a fresh
session key per tick for `'ephemeral'` is unimplemented.

`retentionDays` is likewise schema-only: it round-trips through
`default-nodes.ts` → `graph-to-agent.ts` → `ResolvedCronConfig`, but no
maintenance or storage-pruning path reads it. This is distinct from
storage's own `resetArchiveRetentionDays`, which storage-engine.ts does
read.

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
