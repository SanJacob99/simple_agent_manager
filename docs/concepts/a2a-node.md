# A2A Interop Node

> Exposes the agent over the Agent-to-Agent (A2A) protocol — publish an agent card and accept remote tasks (server), and/or register remote A2A agents as callable delegate tools (client). A2A is to cross-framework agent interop what MCP is to tools.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-04 -->

## Overview

The A2A node lets this agent participate in the emerging **Agent-to-Agent (A2A)** protocol — the standardizing wire format for agents built on *different* frameworks to discover and delegate to one another (agent cards, task/message envelopes, streaming updates). It has two independent sides, selected by `role`:

- **Server** (`role: 'server' | 'both'`): publish an *agent card* (a JSON descriptor of identity, capabilities, and advertised skills) at `publicUrl + cardPath`, and accept inbound tasks over the chosen `transport`. This makes the agent callable by remote agents.
- **Client** (`role: 'client' | 'both'`): register remote A2A agents. Each enabled remote becomes an `a2a_<name>` delegate tool that forwards a task to the remote via `message/send` and returns its result.

This complements the in-tree collaboration nodes — [Agent Comm](agent-comm-node.md) (in-process pub/sub bus) and [Sub-Agent](sub-agent-node.md) (in-tree children) — by reaching agents *outside* this process and framework.

At most one A2A node binds to an agent, so it resolves to a single optional value on `AgentConfig.a2a` (like [Structured Output](structured-output-node.md) and [Reflection](reflection-node.md)) rather than a list.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Serving the agent card / task endpoint from `server/a2a/` routes and wiring delegate tools into `server/tools/tool-factory.ts` (fetch the remote card, resolve its endpoint, POST the `message/send` envelope, extract the result) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `role` | `'server' \| 'client' \| 'both'` | `'client'` | Which side(s) of the protocol to turn on. |
| `serverEnabled` | `boolean` | `false` | Server master toggle. When off, the server side is configured but not served. Ignored unless `role` includes server. |
| `agentName` | `string` | `""` | Name advertised in the agent card. Empty falls back to the agent's own name. |
| `agentDescription` | `string` | `""` | Description advertised in the agent card. |
| `agentVersion` | `string` | `"1.0.0"` | Version string advertised in the agent card. |
| `publicUrl` | `string` | `""` | Base URL other agents reach this server at (advertised in the card). |
| `cardPath` | `string` | `"/.well-known/agent-card.json"` | Path the agent card JSON is served from. |
| `transport` | `'jsonrpc' \| 'grpc' \| 'rest'` | `'jsonrpc'` | Wire protocol the endpoint speaks. |
| `streaming` | `boolean` | `true` | Advertise streaming task updates (`message/stream`). |
| `pushNotifications` | `boolean` | `false` | Advertise push-notification (webhook) capability. |
| `serverAuthScheme` | `'none' \| 'apiKey' \| 'bearer' \| 'oauth2'` | `'none'` | How inbound tasks authenticate. |
| `serverCredentialEnvVar` | `string` | `""` | Env var holding the token/key that authenticates inbound tasks. |
| `skills` | `A2ASkillAdvertisement[]` | `[]` | Capabilities advertised in the card's `skills[]` (`id`, `name`, `description`, `tags`). |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents registered as delegate tools (`name`, `cardUrl`, `endpoint`, `authScheme`, `credentialEnvVar`, `enabled`). |
| `taskTimeoutMs` | `number` | `120000` | Wall-clock ceiling for a single delegated remote task. |

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and neither publish a card nor gain delegate tools.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate:

- **`buildAgentCard(config, fallbackName)`** — assemble the serializable A2A agent card (protocol version, capabilities, security schemes, advertised skills). Trims a trailing slash off `publicUrl` and falls back to the agent's name/`1.0.0` when blank.
- **`isServerActive(config)` / `isClientActive(config)`** — gate each side on `role` (and `serverEnabled` for the server).
- **`buildRemoteDelegateTools(config)`** — produce one descriptor per enabled remote, deriving the `a2a_<slug>` tool name and auto-numbering collisions (`a2a_search`, `a2a_search_2`).
- **`buildTaskEnvelope(text, id, messageId)`** — the JSON-RPC `message/send` request that forwards a task to a remote (id/clock supplied by the caller so the function stays pure).
- **`parseTaskResult(response)`** — recover reply text from the three A2A result shapes (`Message.parts`, `Task.status.message.parts`, `Task.artifacts[].parts`); returns `''` when no text part exists.
- **`validateA2AConfig(config)`** — collect blocking errors (server with no public URL, non-absolute card path, enabled remote with no card URL or endpoint) and advisory warnings (auth scheme with no env var, no advertised skills, delegate tool-name collisions).

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "A2A Interop",
  "role": "both",
  "serverEnabled": true,
  "agentName": "Research Desk",
  "agentDescription": "Answers research questions with cited sources.",
  "agentVersion": "1.2.0",
  "publicUrl": "https://research-desk.example.com",
  "cardPath": "/.well-known/agent-card.json",
  "transport": "jsonrpc",
  "streaming": true,
  "pushNotifications": false,
  "serverAuthScheme": "bearer",
  "serverCredentialEnvVar": "A2A_SERVER_TOKEN",
  "skills": [
    { "id": "sk1", "name": "Literature review", "description": "Summarize a topic with citations", "tags": ["research", "nlp"] }
  ],
  "remoteAgents": [
    {
      "id": "r1",
      "name": "Weather",
      "cardUrl": "https://weather.example.com/.well-known/agent-card.json",
      "endpoint": "",
      "authScheme": "apiKey",
      "credentialEnvVar": "WEATHER_A2A_KEY",
      "enabled": true
    }
  ],
  "taskTimeoutMs": 120000
}
```
