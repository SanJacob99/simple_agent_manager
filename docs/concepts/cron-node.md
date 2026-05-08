# Cron Node

> Schedules an agent to run automatically on a recurring cron schedule.

<!-- source: src/types/nodes.ts#CronNodeData -->
<!-- last-verified: 2026-05-08 -->

## Overview

The Cron Node attaches a recurring schedule to an agent. When the schedule fires, the runtime injects the configured `prompt` as the opening user message and runs the agent in the same way an interactive chat would. This enables autonomous, time-based workflows — daily digests, periodic data pulls, scheduled maintenance tasks — without any external scheduler.

The cron node connects to an Agent Node and is a peripheral node; it cannot connect to other peripheral nodes. Only one cron node may be connected to a given agent.

Session behaviour depends on `sessionMode`. In `persistent` mode the agent reuses a single long-lived session across all cron fires, accumulating memory and context. In `ephemeral` mode each fire gets a fresh session that is discarded once the run completes and reaches the `retentionDays` limit.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Cron Job"` | Display label on the canvas |
| `schedule` | `string` | `"0 9 * * *"` | Standard 5-field cron expression (minute hour day month weekday). Example: `"0 9 * * 1-5"` = 09:00 Monday–Friday |
| `prompt` | `string` | `""` | Message injected as the opening user turn when the schedule fires |
| `enabled` | `boolean` | `true` | When `false` the schedule is paused; no fires occur until re-enabled |
| `sessionMode` | `'persistent' \| 'ephemeral'` | `"persistent"` | `persistent` reuses the same session across fires; `ephemeral` creates a fresh session for each fire |
| `timezone` | `string` | `"local"` | IANA timezone name (e.g. `"America/New_York"`) or `"local"` to use the server's local timezone |
| `maxRunDurationMs` | `number` | `300000` | Hard limit on how long a single cron run may take, in milliseconds (default 5 minutes). The run is aborted if it exceeds this limit |
| `retentionDays` | `number` | `7` | Number of days ephemeral-session transcripts are retained before being pruned |

## Runtime Behavior

Not yet wired to a scheduler at runtime. The `CronNodeData` interface and default values are defined in `src/types/nodes.ts` and `src/utils/default-nodes.ts`, and the type is included in the `FlowNodeData` union. A cron scheduler that reads this config and fires agents on schedule is a planned feature.

## Connections

- Sends to: Agent Node
- Receives from: None

## Example

```json
{
  "type": "cron",
  "label": "Morning Digest",
  "schedule": "0 8 * * 1-5",
  "prompt": "Summarize the latest news and my calendar for today.",
  "enabled": true,
  "sessionMode": "ephemeral",
  "timezone": "America/New_York",
  "maxRunDurationMs": 120000,
  "retentionDays": 7
}
```
