# A2A Interop Node

> Exposes this agent over the emerging Agent-to-Agent (A2A) protocol and/or registers remote A2A agents as callable delegates — the cross-framework counterpart to MCP's tool standardization.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-08 -->

## Overview

`agentComm` is an in-process bus and `subAgent` is in-tree; neither lets this agent talk to agents built on *other* frameworks. The Agent-to-Agent (A2A) protocol — agent cards, task/message envelopes, and streaming updates — is becoming the lingua franca for cross-framework agent interop, much as MCP standardized tools. The A2A node brings the builder in line with that ecosystem.

It carries two independently toggleable roles:

- **Server** (`exposeServer`) — publish an [agent card](https://a2a-protocol.org) and accept inbound A2A tasks so agents on other frameworks can call this agent.
- **Client** (`exposeDelegateTool`) — register remote A2A agents as delegates and expose a `delegate_to_agent` tool that hands a task to one of them over the A2A `message/send` method.

At most one A2A node binds to an agent — it configures both roles — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like Structured Output and Reflection).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the HTTP transport into `server/a2a/` — the `<serverPath>/.well-known/agent-card.json` route, the `message/send` endpoint with `serverAuthScheme` enforcement, and the `delegate_to_agent` tool handler — is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but neither role is active. |
| `exposeServer` | `boolean` | `false` | Publish an agent card and accept inbound A2A tasks. |
| `agentName` | `string` | `""` | Name advertised in the card. Empty falls back to the agent's name. |
| `agentDescription` | `string` | `""` | Description advertised in the card. Empty falls back to the agent's description. |
| `serverPath` | `string` | `"/a2a"` | Mount path for the A2A endpoint; the card is served at `<serverPath>/.well-known/agent-card.json`. |
| `advertiseStreaming` | `boolean` | `true` | Advertise `capabilities.streaming` (SSE `message/stream`) in the card. |
| `advertisePushNotifications` | `boolean` | `false` | Advertise `capabilities.pushNotifications` in the card. |
| `serverAuthScheme` | `'none' \| 'bearer' \| 'apiKey'` | `'none'` | Auth scheme remote clients must satisfy to reach the exposed server. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote agents registered as delegates (`id`, `name`, `cardUrl`, `authScheme`, `authToken`). |
| `exposeDelegateTool` | `boolean` | `true` | Expose a `delegate_to_agent` tool enumerating the registered remotes. |
| `maxDelegationDepth` | `number` | `2` | Max nested delegation hops before a delegate call is refused. Loop control. |
| `taskTimeoutMs` | `number` | `60000` | Per-remote-task timeout in milliseconds. |

Each `A2ARemoteAgent` carries a stable local `id` (used in the delegate tool's target enum), a display `name`, the `cardUrl` of the remote agent card, an `authScheme`, and an `authToken` — treated as an **environment-variable name** so secrets never live in the serialized graph.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and expose neither an A2A server nor the delegate tool.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate the server/runtime call:

- **`buildAgentCard(config, opts)`** — assembles the discovery document served at `<serverPath>/.well-known/agent-card.json`: protocol version, absolute `url`, capabilities (mirroring the advertise toggles), and security schemes (mirroring `serverAuthScheme`). `name`/`description` fall back to the agent's own when blank.
- **`validateAgentCard(input)`** — validates a fetched remote card (requires a `name` and an http(s) `url`), filling sensible defaults for missing optional fields.
- **`resolveRemoteAgent(config, id)`** — looks up a registered remote by its local id.
- **`buildAuthHeaders(remote, resolveEnv?)`** — builds `Authorization: Bearer …` / `X-API-Key: …` headers, reading `authToken` as an env var (defaults to `process.env`); returns `{}` for `none` or an unset var.
- **`canDelegate(config, depth)`** — the delegation guard: false when disabled, the tool is off, there are no remotes, or `depth` has reached `maxDelegationDepth`.
- **`buildDelegateToolSpec(config)`** — the `delegate_to_agent` tool definition, with the remote ids as an `enum` so the model can only target a configured agent; `null` when delegation is off or no remotes are registered.
- **`buildMessageSendParams(text, messageId)`** — the JSON-RPC `params` for an A2A `message/send` call; the caller supplies the envelope and a unique `messageId`.
- **`parseTaskResult(result)`** — normalizes a `message/send` result (Task or bare Message) into `{ state, text, error? }`, preferring artifact text and surfacing status-message text as the error on `failed`/`rejected`.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "exposeServer": true,
  "agentName": "Research Concierge",
  "agentDescription": "Answers research questions and delegates deep dives.",
  "serverPath": "/a2a",
  "advertiseStreaming": true,
  "advertisePushNotifications": false,
  "serverAuthScheme": "bearer",
  "remoteAgents": [
    {
      "id": "scholar",
      "name": "Scholar Agent",
      "cardUrl": "https://scholar.example/.well-known/agent-card.json",
      "authScheme": "bearer",
      "authToken": "SCHOLAR_A2A_TOKEN"
    }
  ],
  "exposeDelegateTool": true,
  "maxDelegationDepth": 2,
  "taskTimeoutMs": 60000
}
```
