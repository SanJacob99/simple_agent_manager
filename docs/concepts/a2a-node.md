# A2A (Agent-to-Agent) Node

> Exposes this agent over the Agent-to-Agent (A2A) protocol — publish an agent card and accept remote tasks (server), and/or register remote A2A agents as callable delegates (client) — so it can interoperate with agents built on *other* frameworks.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-09 -->

## Overview

Where the [Agent Comm node](agent-comm-node.md) is an in-process bus and the [Sub-Agent node](sub-agent-node.md) is in-tree, the A2A node lets this agent talk to agents built on **other frameworks**. It mirrors the emerging Agent-to-Agent (A2A) protocol — agent cards, task/message envelopes, and streaming task updates — that is becoming the cross-framework lingua franca for agents, much as MCP standardized tools.

An A2A node has a `role`:

- **`server`** — publish an agent card at `<serverPath>/.well-known/agent.json` and accept inbound tasks, exposing this agent to remote callers.
- **`client`** — register remote A2A agents (`remoteAgents`) as callable delegates this agent can hand tasks to.
- **`both`** — do both; the common case for a mesh of interoperating agents.

At most one A2A node binds to an agent — it owns the single server mount and the delegate registry — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like [Reflection](reflection-node.md) and [Structured Output](structured-output-node.md)).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. The engine (`server/runtime/a2a-engine.ts`) provides the dependency-free substrate — agent-card assembly, the task lifecycle state machine, delegate resolution, and the message/result envelope shapes — but the HTTP surface (mounting the card + `message/send` endpoint under `server/a2a/`) and the outbound client are the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no card is served and no delegates registered. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Whether this agent acts as an A2A server, client, or both. |
| `agentName` | `string` | `""` | Name published on the agent card. Empty falls back to the agent's own name. |
| `agentDescription` | `string` | `""` | Description published on the agent card. |
| `serverPath` | `string` | `"/a2a"` | HTTP path the A2A server mounts under. |
| `streaming` | `boolean` | `true` | Advertise streaming task updates (SSE) in the card's capabilities. |
| `publishSkills` | `boolean` | `true` | Advertise this agent's resolved tools/skills as A2A skills on the card. |
| `authScheme` | `'none' \| 'apiKey' \| 'bearer'` | `'bearer'` | Auth scheme advertised on the card and used when calling delegates. |
| `remoteAgents` | `RemoteA2AAgent[]` | `[]` | Remote A2A agents registered as callable delegates (client role). |
| `defaultTimeoutMs` | `number` | `60000` | Per-task timeout in milliseconds for delegated calls. |
| `maxConcurrentTasks` | `number` | `4` | Max concurrent inbound + delegated tasks before new ones queue. |

Each `RemoteA2AAgent` has `{ id, name, url, description }`, where `id` is the stable local handle and `url` is the base URL of the remote A2A server.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and neither publish a card nor register delegates.

`server/runtime/a2a-engine.ts` provides the interop substrate (dependency-free):

- **`buildAgentCard(config, opts)`** — assemble the A2A agent card (name/description/url/version, capabilities, auth schemes, and — when `publishSkills` is set — the advertised skills). `joinUrl` combines `baseUrl` and `serverPath`.
- **`A2A_TASK_STATES` / `isTerminalState` / `canTransition(from, to)`** — the task lifecycle state machine (`submitted → working ↔ input-required → completed | canceled | failed | rejected`); transitions out of a terminal state are rejected.
- **`validateRemoteAgent(agent)`** — guards the delegate registry (missing id/url, non-http(s) url) so a malformed entry fails loudly rather than at first call.
- **`selectDelegate(config, handle)`** — resolves a delegate by local `id` or case-insensitive name; returns `null` for a server-only node or an unknown handle.
- **`buildTaskMessage(text, opts)`** — the outbound `message/send` params for delegating a task.
- **`extractTaskText(result)`** — pulls the reply text out of a returned task, preferring artifact text parts and falling back to the last agent message.

Wiring the HTTP server surface and outbound client into `server/a2a/` — serve the card, accept `message/send`, drive tasks through the validated lifecycle, and call registered delegates — is the remaining integration step.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "role": "both",
  "agentName": "Research Desk",
  "agentDescription": "Answers research questions with cited sources.",
  "serverPath": "/a2a",
  "streaming": true,
  "publishSkills": true,
  "authScheme": "bearer",
  "remoteAgents": [
    {
      "id": "coder",
      "name": "Coding Agent",
      "url": "https://agents.example.com/coder/a2a",
      "description": "Writes and runs code on request."
    }
  ],
  "defaultTimeoutMs": 60000,
  "maxConcurrentTasks": 4
}
```
