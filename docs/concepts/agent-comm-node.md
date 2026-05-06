# Agent Communication Node

> Wakes a peer agent on send. Bounded by per-pair turn/depth/token limits and per-sender rate limits.

<!-- source: src/types/nodes.ts#AgentCommNodeData -->
<!-- last-verified: 2026-05-06 -->

## Overview

The Agent Communication Node connects two long-lived agents in a graph for peer-to-peer messaging. Direct comm nodes form a **reciprocal pair contract**: both agents must declare each other for a send to succeed. A successful `agent_send` wakes the receiver in a dedicated **channel-session** shared between the pair (key shape: `channel:<lo>:<hi>`).

For one-shot child dispatch from a parent agent, see [Sub-Agent Node](./sub-agent-node.md). The two flows are independent — sub-agents do not get comm tools.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Agent Comm"` | Display label |
| `targetAgentNodeId` | `string \| null` | `null` | Peer agent node id (direct only) |
| `protocol` | `'direct' \| 'broadcast'` | `'direct'` | Direct = one-to-one; broadcast = fan-out to declared `direct` peers |
| `direction` | `'bidirectional' \| 'outbound' \| 'inbound'` | `'bidirectional'` | Per-comm-node lock |
| `maxTurns` | `number` | `10` | Hard ceiling on accepted sends in this channel before auto-seal |
| `maxDepth` | `number` | `3` | Cascade depth across chained sends |
| `tokenBudget` | `number` | `100_000` | Cumulative model tokens for this channel before auto-seal |
| `rateLimitPerMinute` | `number` | `30` | Sender-side outbound count across all peers (rolling 60s) |
| `messageSizeCap` | `number` | `16_000` | Max message length in characters |

Pair-symmetric controls take the **minimum** of the two endpoints' values.

Workspace-level defaults can be overridden in `Settings → Agent Comm Defaults`; new comm nodes inherit those overrides at creation time.

## Runtime Behavior

1. `resolveAgentConfig()` walks each agent's connected comm nodes and produces `ResolvedAgentCommConfig[]` with `commNodeId`, `targetAgentName`, and the v1 limit/safety fields.
2. `AgentManager` registers each managed agent with the singleton `AgentCommBus`.
3. When an agent's `agentComm.length > 0`, its tool surface auto-includes `agent_send` (per direct peers), `agent_channel_history`, and (when a broadcast comm node is attached) `agent_broadcast`.
4. `agent_send` runs eight pre-flight checks in order — topology → direction → message size → rate → channel state → token budget → depth → turn count — then appends a user-role message to `channel:<lo>:<hi>`, emits an audit event, and (unless `end:true`) wakes the receiver via `RunCoordinator.dispatchChannel`.
5. The receiver runs in **channel mode**: its system prompt is augmented with a channel-context block; the inbound message is the most-recent transcript event; tool calls (including more `agent_send`) are accepted up to the limits.
6. Reaching `maxTurns` or exhausting `tokenBudget` seals the channel. Further sends return `channel_sealed`. Reaching `maxDepth` returns `depth_exceeded` without sealing. Exceeding `rateLimitPerMinute` returns `rate_limited` without sealing.
7. Channel-sessions live under the canonical `<lo>` agent's `StorageEngine` and are hidden from normal session listings; the `Peer channels` section in the chat drawer surfaces them read-only.

## Connections

- **Direct comm node:** requires reciprocal `direct` comm nodes on BOTH endpoints (one-sided contracts fail at runtime as `topology_violation`).
- **Broadcast comm node:** a single broadcast node attached to an agent enables `agent_broadcast`, which fans out to that agent's direct peers.
- **Sub-agents do not receive comm tools**, even when the parent declares peers.

## Tools (auto-injected)

- `agent_send({ to, message, end? })` — wake the receiver (or just append if `end:true`).
- `agent_broadcast({ message, end? })` — fan out to every direct peer; per-peer outcomes returned.
- `agent_channel_history({ with, limit? })` — read recent events from the channel transcript with a peer.

## Example

A↔B with stricter limits:

```json
[
  { "type": "agentComm", "label": "to-beta", "protocol": "direct",
    "targetAgentNodeId": "agent-b", "direction": "bidirectional",
    "maxTurns": 5, "maxDepth": 2, "tokenBudget": 50000,
    "rateLimitPerMinute": 10, "messageSizeCap": 8000 },
  { "type": "agentComm", "label": "to-alpha", "protocol": "direct",
    "targetAgentNodeId": "agent-a", "direction": "bidirectional",
    "maxTurns": 5, "maxDepth": 2, "tokenBudget": 50000,
    "rateLimitPerMinute": 10, "messageSizeCap": 8000 }
]
```
