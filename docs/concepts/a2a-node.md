# A2A Interop Node

> Exposes the agent over the emerging Agent-to-Agent (A2A) protocol — publishing an agent card and accepting inbound tasks — and/or registers remote A2A agents as callable delegates.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-07 -->

## Overview

Where the [Agent Comm node](agent-comm-node.md) is an in-process bus and the [Sub-Agent node](sub-agent-node.md) is in-tree, the A2A node is the cross-framework *wire* protocol. The [Agent-to-Agent (A2A) protocol](https://a2a-protocol.org) is becoming the lingua franca for interop between agents built on *different* stacks — agent cards for discovery, task/message envelopes for work, and streaming/webhook updates for progress — much as MCP standardized tools.

The node has two surfaces, selected by `role`:

- **Server** — publish an agent card at `<serverPath>/.well-known/agent-card.json` and accept inbound tasks, making this agent callable by any A2A client.
- **Client** — register remote A2A agents (by their card URL) as callable delegates; each remote becomes a tool named `a2a_<slug>` that dispatches an outbound task.

`both` does both. At most one A2A node binds to an agent — it owns the single published server surface / delegate registry — so it resolves to a single optional value on `AgentConfig.a2a` (like Reflection and Structured Output) rather than a list.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the server transport (mount `serverPath`, serve the card, gate + dispatch inbound tasks to headless runs) and the client transport (fetch remote cards, register delegate tools, post outbound tasks) into `server/a2a/` is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but neither server nor client is active. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Whether this agent exposes an A2A server, consumes remote agents, or both. |
| `agentName` | `string` | `""` | `name` of the published agent card. Empty falls back to the agent's own name at serve time. |
| `agentDescription` | `string` | "An agent exposed over the Agent-to-Agent protocol." | `description` of the published agent card. |
| `agentVersion` | `string` | `"1.0.0"` | Semantic version advertised in the agent card. |
| `serverPath` | `string` | `"/a2a"` | HTTP path the A2A server mounts at. |
| `advertisedSkills` | `string[]` | `[]` | Skill tags surfaced in the agent card's `skills` array for remote discovery. |
| `streaming` | `boolean` | `true` | Advertise the `streaming` capability (SSE task updates). |
| `pushNotifications` | `boolean` | `false` | Advertise the `pushNotifications` capability (webhook task updates). |
| `requireAuth` | `boolean` | `false` | Require a bearer token on inbound tasks. |
| `inboundTokenEnv` | `string` | `""` | Env var holding the accepted inbound bearer token (used when `requireAuth`). |
| `remotes` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents registered as callable delegates. |
| `maxConcurrentTasks` | `number` | `4` | Ceiling on simultaneous inbound + outbound tasks. `0` disables the ceiling. |
| `taskTimeoutMs` | `number` | `120000` | Per-task wall-clock timeout in milliseconds. `0` disables the ceiling. |

Each `A2ARemoteAgent` has `id`, `name`, `cardUrl` (conventionally `https://host/.well-known/agent-card.json`), `authTokenEnv` (env var holding the outbound bearer token; empty = unauthenticated), and `enabled`.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and neither an A2A server nor any delegate is registered.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate the server layer calls:

- **`buildAgentCard(config, { baseUrl, fallbackName })`** — assembles the published agent card (protocol version, discovery URL, capabilities, slugged skills). `fallbackName` supplies the agent's own name when `agentName` is empty.
- **`parseTaskRequest(payload)`** — validates and normalizes an inbound JSON-RPC 2.0 `message/send` / `message/stream` envelope into `{ requestId, messageId, text }`, or returns a human-readable error.
- **`parseAgentCard(text)`** — parses and minimally validates a remote card (strict on `name`/`url`, tolerant of missing optionals) before it is registered as a delegate.
- **`enabledRemotes(config)`** — the remotes that are actually registered (enabled and carrying a card URL).
- **`delegateToolName(remote)`** — the namespaced, slugged tool name (`a2a_<slug>`) a remote delegate is exposed under.
- **`authorizeInbound(config, presentedToken, expectedToken)`** — gates inbound requests: open when `requireAuth` is off, otherwise fails closed unless the presented bearer token matches the configured one.
- **`isTerminalTaskState(state)`** — whether an A2A task state (`submitted`/`working`/`input-required`/`completed`/`canceled`/`failed`/`rejected`) is terminal.
- **`TaskConcurrencyGuard`** — bounds in-flight tasks at `maxConcurrentTasks` (0 = unbounded), mirroring the budget engine's ledger style.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "A2A Interop",
  "enabled": true,
  "role": "both",
  "agentName": "Research Desk",
  "agentDescription": "Runs literature searches and returns cited summaries.",
  "agentVersion": "1.2.0",
  "serverPath": "/a2a",
  "advertisedSkills": ["research", "summarize"],
  "streaming": true,
  "pushNotifications": false,
  "requireAuth": true,
  "inboundTokenEnv": "A2A_INBOUND_TOKEN",
  "remotes": [
    {
      "id": "coder-1",
      "name": "Coding Agent",
      "cardUrl": "https://coder.example/.well-known/agent-card.json",
      "authTokenEnv": "CODER_A2A_TOKEN",
      "enabled": true
    }
  ],
  "maxConcurrentTasks": 4,
  "taskTimeoutMs": 120000
}
```
