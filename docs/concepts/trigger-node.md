# Trigger Node

> Generalizes the cron scheduler beyond time: webhooks, filesystem changes, queue messages, and manual "run now" fires all feed the same headless-run path the cron node already uses.

<!-- source: src/types/nodes.ts#TriggerNodeData -->
<!-- last-verified: 2026-07-29 -->

## Overview

`cron` covers time-based firing. Modern agents also need to react to events: an inbound webhook (deploy finished, PR opened, form submitted), a filesystem change (a file dropped into a watched folder), a queue message, or an explicit manual fire. The Trigger node is an **event-source registry** that covers those cases, resolving each connected node into a source the runtime registers and routes through the same headless-run path the [Cron node](cron-node.md) uses.

Multiple Trigger nodes can bind to a single Agent — each registers its own source — so they resolve to a **list** on `AgentConfig.triggers` (like crons, telemetry, and budgets) rather than a single optional value.

> **Status:** the node, resolved config, and the dependency-free `TriggerRegistry` decision substrate are scaffolded and unit-tested. Wiring the registry into `server/scheduling/` alongside `CronScheduler` (mounting webhook receivers, starting filesystem watchers, draining queues, and routing each fire into the `RunCoordinator`) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Trigger"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the source is registered but never fires. |
| `kind` | `'webhook' \| 'fileWatch' \| 'queue' \| 'manual'` | `'webhook'` | Which kind of event source this node listens on. |
| `prompt` | `string` | "A trigger fired. Handle the event described below." | Prompt fed to the headless run; the event payload is appended in a fenced block. |
| `sessionMode` | `'persistent' \| 'ephemeral'` | `'ephemeral'` | Whether a fire reuses a persistent session or spins a fresh one (mirrors cron). |
| `webhookPath` | `string` | `"/hook"` | `webhook`: path suffix the server mounts the receiver at. Must start with `/`. |
| `webhookSecret` | `string` | `""` | `webhook`: shared secret required in the `X-Signature` header. Empty accepts unsigned requests. |
| `watchPaths` | `string` | `""` | `fileWatch`: comma-separated globs under the workspace to watch. |
| `watchEvents` | `('add' \| 'change' \| 'unlink')[]` | `['add', 'change']` | `fileWatch`: which filesystem events fire the trigger. |
| `queueName` | `string` | `""` | `queue`: name of the in-process queue this trigger drains. |
| `debounceMs` | `number` | `0` | Minimum ms between fires; bursts inside the window collapse into a single run. `0` disables debounce. |
| `maxRunDurationMs` | `number` | `300000` | Hard ceiling on a single triggered run's wall-clock. |
| `retentionDays` | `number` | `7` | How many days of fire history to retain. |

Properties are derived from `src/types/nodes.ts#TriggerNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves every connected Trigger node into a `ResolvedTriggerConfig` on `AgentConfig.triggers` (`shared/agent-config.ts`). Agents without one have `triggers === undefined` / `[]` and fire only on cron and interactive input.

`server/scheduling/trigger-registry.ts` provides the decision substrate (dependency-free; time is supplied by the caller via the event's `at`, so it stays deterministic and testable):

- **`TriggerRegistry`** — holds the enabled sources for one agent. `reconcile(triggers)` swaps in the current config (dropping debounce state for removed sources); `fire(event)` decides whether an inbound event fires its source and returns a `TriggerDecision`.
- **`fire(event)`** applies, in order: unknown-source, disabled, kind-mismatch, webhook signature, then the per-source debounce window. Only a fully accepted event advances the debounce clock — a rejected event never resets it.
- **`verifyWebhookSignature(secret, presented)`** — length-aware shared-secret comparison; an empty configured secret accepts unsigned requests.
- **`validateTriggerConfig(config)`** — pre-flight validation returning human-readable problems (empty when valid), mirroring the schedule-string check the cron scheduler does before registering a job.
- **`buildRunPrompt(config, event)`** — composes the run prompt: the configured prompt with the event payload appended as a fenced block (string passed through; objects JSON-serialized).
- **`parseWatchGlobs(watchPaths)`** — splits the comma-separated `watchPaths` field into trimmed, non-empty globs for the filesystem watcher.

## Connections

Peripheral → Agent. Multiple Trigger nodes may bind to a single Agent; each resolves to its own entry in `AgentConfig.triggers`.

## Example

```json
{
  "type": "trigger",
  "label": "Deploy webhook",
  "enabled": true,
  "kind": "webhook",
  "prompt": "A deploy webhook fired. Summarize the result and post to the release channel.",
  "sessionMode": "ephemeral",
  "webhookPath": "/deploy",
  "webhookSecret": "shared-signing-secret",
  "watchPaths": "",
  "watchEvents": ["add", "change"],
  "queueName": "",
  "debounceMs": 5000,
  "maxRunDurationMs": 300000,
  "retentionDays": 14
}
```
