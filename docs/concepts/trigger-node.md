# Trigger Node

> Event-driven counterpart to the Cron node: fires a run when an external event arrives — an inbound webhook, a filesystem change, a queue message, or delivered email — instead of on a time schedule.

<!-- source: src/types/nodes.ts#TriggerNodeData -->
<!-- last-verified: 2026-07-22 -->

## Overview

Where the [Cron node](cron-node.md) covers *time*, the Trigger node generalizes the scheduler into an **event-source registry**. Modern agents fire on webhooks, file changes, queue messages, and inbound email — the same event surfaces you see in n8n, Zapier, Temporal, and the LangGraph/AutoGen event loops. Each matching event renders the trigger's `prompt` (with the event payload substituted) and starts a run down the same headless-run path the cron scheduler already uses.

Multiple Trigger nodes can bind to one agent (e.g. a webhook *and* a file watch), so triggers resolve to a **list** on `AgentConfig.triggers` — mirroring how `crons` resolves — rather than a single value.

> **Status:** the node, resolved config, and engine (`server/scheduling/trigger-registry.ts`) are scaffolded and unit-tested. The engine owns event → prompt rendering, the filter grammar, the file-glob matcher, per-trigger admission (debounce + concurrency), and validation. Wiring the transports (the webhook HTTP listener, the fs watcher, the queue consumer, HMAC signature verification) and dispatching admitted events through `server/agents/run-coordinator.ts` is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Trigger"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the trigger is wired but never fires. |
| `source` | `'webhook' \| 'fileWatch' \| 'queue' \| 'emailInbound' \| 'manual'` | `'webhook'` | Which event source drives the trigger. |
| `prompt` | `string` | `""` | Prompt template fired on a match. `{{event}}` expands to the whole payload; `{{event.field}}` to one field. |
| `sessionMode` | `'persistent' \| 'ephemeral'` | `'ephemeral'` | Reuse the agent's persistent session or start a fresh one per event. |
| `filter` | `string` | `""` | Optional boolean filter over the payload (e.g. `event.action == "opened"`). Empty fires on every event. |
| `debounceMs` | `number` | `0` | Coalesce a burst of events within this window into one run. `0` disables debouncing. |
| `maxConcurrent` | `number` | `1` | Max runs this trigger may have in flight at once; further events queue. |
| `retentionDays` | `number` | `7` | How long to keep run records produced by this trigger. |
| `webhookPath` | `string` | `"/hooks/incoming"` | *(webhook)* URL path the listener mounts at; must start with `/`. |
| `webhookMethod` | `'POST' \| 'GET' \| 'PUT'` | `'POST'` | *(webhook)* HTTP method accepted. |
| `webhookSecretEnvVar` | `string` | `""` | *(webhook)* Env var holding the HMAC secret used to verify signatures. Empty = unauthenticated. |
| `watchPath` | `string` | `""` | *(fileWatch)* Directory or file to watch. |
| `watchGlob` | `string` | `""` | *(fileWatch)* Glob applied to changed paths (`*` within a segment, `**` across, `?` one char). Empty = all. |
| `watchEvents` | `('create' \| 'modify' \| 'delete')[]` | `['create', 'modify']` | *(fileWatch)* Filesystem events that fire the trigger. |
| `queueTarget` | `string` | `""` | *(queue)* Queue / stream / topic to subscribe to. |
| `queueConnectionEnvVar` | `string` | `""` | *(queue)* Env var holding the queue connection string / credentials. |
| `emailAddress` | `string` | `""` | *(emailInbound)* Address or mailbox the trigger listens on. |

Properties are derived from `src/types/nodes.ts#TriggerNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves every connected Trigger node into a `ResolvedTriggerConfig` on `AgentConfig.triggers` (`shared/agent-config.ts`). Agents without one have `triggers` empty and run only on direct chat and any `crons`.

`server/scheduling/trigger-registry.ts` provides the dependency-free substrate:

- **`renderPrompt(config, event)`** — substitutes `{{event}}` / `{{event.field}}` in the prompt against the event payload.
- **`evaluateFilter(filter, event)`** — a small, safe filter grammar (not `eval`): equality/inequality against quoted strings, numbers, booleans, and `null`, plus bare-field truthiness. An empty filter always matches; anything unparseable fails closed.
- **`matchesFileEvent(config, event)`** — for `fileWatch`, checks the fs event kind against `watchEvents` and the changed path against `watchGlob`.
- **`validateTrigger(config)`** — returns the human-readable problems (missing webhook path, empty watch path, etc.) that would stop a trigger from firing usefully.
- **`webhookAuthRequired(config)` / `describeTrigger(config)`** — helpers for the listener and the node UI.
- **`TriggerGate`** — a stateful per-agent admission gate. `admit(config, event, now)` applies enabled → validation → filter → leading-edge debounce → concurrency ceiling and, on success, returns `{ action: 'run', prompt }`; `complete(triggerNodeId)` releases a concurrency slot when the run settles.

## Connections

Peripheral → Agent. Multiple Trigger nodes may bind to a single Agent; each resolves independently into the `triggers` list.

## Example

```json
{
  "type": "trigger",
  "label": "GitHub PR opened",
  "enabled": true,
  "source": "webhook",
  "prompt": "A pull request was {{event.action}}: {{event.pull_request.title}}. Review it and post a summary.",
  "sessionMode": "ephemeral",
  "filter": "event.action == \"opened\"",
  "debounceMs": 0,
  "maxConcurrent": 2,
  "retentionDays": 14,
  "webhookPath": "/hooks/github",
  "webhookMethod": "POST",
  "webhookSecretEnvVar": "GITHUB_WEBHOOK_SECRET"
}
```
