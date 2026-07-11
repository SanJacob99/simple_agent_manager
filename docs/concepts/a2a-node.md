# A2A Node

> Exposes the agent over the Agent-to-Agent (A2A) protocol — publishing an Agent Card so other frameworks can task it, registering remote A2A agents as callable delegates, or both.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-11 -->

## Overview

The A2A node connects this agent to the emerging **Agent-to-Agent (A2A)** protocol — the cross-framework interop layer standardizing how agents discover and call one another over HTTP. An agent publishes an **Agent Card** (identity, capabilities, and advertised skills); callers fetch it (conventionally at `…/.well-known/agent-card.json`) and exchange **task**/**message** envelopes, receiving streaming status updates as a task moves through its lifecycle. A2A does for agent↔agent calls what MCP did for tools.

Where [`agentComm`](agent-comm-node.md) is an in-process bus and [`subAgent`](sub-agent-node.md) defines in-tree children, A2A reaches agents built on *other* stacks. A node can operate as a **server** (publish a card and accept remote tasks), a **client** (register remote agents as delegates), or **both**.

At most one A2A node binds to an agent — it owns the single published card — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like [Structured Output](structured-output-node.md) and [Reflection](reflection-node.md)).

> **Status:** the node, resolved config, and engine (`server/a2a/a2a-engine.ts`) are scaffolded and unit-tested. The HTTP surface — serving the card, a JSON-RPC/REST task endpoint, SSE streaming, and the fetch client that dispatches to remotes (`server/a2a/a2a-server.ts`) — plus wiring into `server/agents/run-coordinator.ts` is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no card is served and no remote is called. |
| `mode` | `'server' \| 'client' \| 'both'` | `'both'` | Whether this agent publishes a card, consumes remotes, or both. |
| `agentName` | `string` | `""` | Card `name` — how this agent identifies itself. Falls back to `label` when blank. |
| `agentDescription` | `string` | `""` | Card `description` — one line on what this agent does. |
| `agentUrl` | `string` | `"http://localhost:8787"` | Base URL this agent is served from (the card's `url`). |
| `version` | `string` | `"0.1.0"` | Semantic version of this agent's published interface. |
| `streaming` | `boolean` | `true` | Advertise streaming task updates (`capabilities.streaming`). |
| `pushNotifications` | `boolean` | `false` | Advertise push-notification task updates (`capabilities.pushNotifications`). |
| `authScheme` | `'none' \| 'bearer' \| 'apiKey'` | `'none'` | Security scheme advertised on the card. |
| `skills` | `A2ASkillEntry[]` | `[]` | Capabilities advertised on the card (`id`, `name`, `description`, `tags`). |
| `remotes` | `A2ARemoteEntry[]` | `[]` | Remote A2A agents registered as delegates (`name`, `cardUrl`, `authScheme`, `authTokenRef`). |
| `taskTimeoutMs` | `number` | `60000` | How long to await a remote's terminal state before giving up. |
| `maxConcurrentTasks` | `number` | `4` | Cap on concurrently in-flight delegated tasks. |
| `onRemoteError` | `'fail' \| 'warn' \| 'ignore'` | `'warn'` | Behaviour when a delegated remote task fails or times out. |

Credentials are referenced by env-var name (`authTokenRef`) — the secret itself is never stored in the graph. Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null`.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate (ids and timestamps are passed in by the caller so every call is deterministic under test):

- **`buildAgentCard(config)`** — assembles the Agent Card this agent publishes, including `capabilities`, `skills`, and the `securitySchemes`/`security` blocks derived from `authScheme`.
- **`validateAgentCard(card)`** — validates a card fetched from a remote before trusting it; returns a list of problems (empty = usable). Tolerant of unknown extra fields.
- **`buildMessage(...)` / `buildSendMessageRequest(...)`** — construct an A2A `message` envelope and the `message/send` (or `message/stream`) JSON-RPC request that dispatches it to a remote.
- **`parseTaskResult(response)`** — extracts an `A2ATaskResult` (state, terminal flag, reply text) from a remote's response, understanding both a `Task` (artifacts/history) and a bare synchronous `Message`. Returns `null` on a JSON-RPC error, mapping to `onRemoteError`.
- **`normalizeTaskState(raw)` / `isTerminalState(state)`** — coerce and classify the A2A task lifecycle (`submitted`, `working`, `input-required`, `completed`, `canceled`, `failed`, `rejected`).
- **`selectDelegate(config, hint)`** — picks which registered remote should handle a request by matching a capability hint against remote ids/names.
- **`servesCard(config)` / `delegatesToRemotes(config)`** — mode+enabled gates for the server and client halves.

The HTTP endpoints and run-coordinator wiring that call this substrate are not yet implemented.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "mode": "both",
  "agentName": "Researcher",
  "agentDescription": "Answers multi-source research questions and returns cited findings.",
  "agentUrl": "https://agents.example.com/researcher",
  "version": "1.0.0",
  "streaming": true,
  "pushNotifications": false,
  "authScheme": "bearer",
  "skills": [
    { "id": "research", "name": "Deep research", "description": "Multi-source web research with citations", "tags": ["web", "search"] }
  ],
  "remotes": [
    { "id": "coder", "name": "Coding agent", "cardUrl": "https://agents.example.com/coder/.well-known/agent-card.json", "authScheme": "bearer", "authTokenRef": "CODER_A2A_TOKEN" }
  ],
  "taskTimeoutMs": 90000,
  "maxConcurrentTasks": 4,
  "onRemoteError": "warn"
}
```
