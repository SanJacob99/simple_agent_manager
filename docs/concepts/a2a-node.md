# A2A (Agent-to-Agent) Interop Node

> Gives an agent a cross-framework interop surface: publish an Agent Card so remote clients can discover and task it (server role), and/or register remote A2A agents as callable delegates (client role), over JSON-RPC / gRPC / REST.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-16 -->

## Overview

`agentComm` is an in-process bus and `subAgent` is in-tree; neither lets this agent talk to agents built on *other* frameworks. The [Agent-to-Agent (A2A) protocol](https://a2a-protocol.org) — agent cards, task/message envelopes, and streaming updates over JSON-RPC 2.0 (with gRPC and REST bindings in 0.3+) — is becoming the cross-framework lingua franca for agent interop, much as MCP standardized tools. Now stewarded by the Linux Foundation, it is supported across the major agent frameworks.

The A2A node exposes an agent two ways, selected by `role`:

- **Server** — publish an **Agent Card** at a well-known path and accept remote tasks. The card advertises the agent's name, endpoint, capabilities (streaming, push notifications), input/output modes, security scheme, and discoverable skills.
- **Client** — register remote A2A agents by their card URL; each is exposed to the local agent as a callable **delegate tool** that forwards a sub-task over the declared transport.
- **Both** — a hub agent that is itself reachable *and* can delegate to peers.

At most one A2A node binds to an agent — it owns the single external-interop surface — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like Structured Output and Reflection).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Serving the Agent Card, running the task lifecycle, and binding remote delegates as tools in `server/a2a/` (and wiring the delegate call into the run-coordinator) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no A2A surface is served and no delegates are exposed. |
| `role` | `'server' \| 'client' \| 'both'` | `'server'` | Whether the agent is published, consumes remote agents, or both. |
| `protocolVersion` | `string` | `"0.3.0"` | A2A protocol version advertised / negotiated. |
| `transport` | `'jsonrpc' \| 'grpc' \| 'rest'` | `'jsonrpc'` | Default transport binding for A2A traffic. |
| `exposeAgentCard` | `boolean` | `true` | *(server)* Publish the Agent Card at the well-known path. |
| `cardName` | `string` | `""` | *(server)* Name advertised on the card. Empty falls back to the agent's own name. |
| `cardDescription` | `string` | "An agent built with…" | *(server)* Description advertised on the card. |
| `serverUrl` | `string` | `"http://localhost:8787"` | *(server)* Public base URL the agent is reachable at. |
| `wellKnownPath` | `string` | `"/.well-known/agent-card.json"` | *(server)* Path the Agent Card is served from. |
| `streaming` | `boolean` | `true` | *(server)* Advertise SSE streaming (`message/stream`). |
| `pushNotifications` | `boolean` | `false` | *(server)* Advertise push-notification (webhook) task updates. |
| `authScheme` | `'none' \| 'apiKey' \| 'bearer' \| 'oauth2'` | `'none'` | *(server)* Security scheme advertised on the card. |
| `inputModes` | `string[]` | `['text/plain']` | *(server)* Default input MIME modes advertised on the card. |
| `outputModes` | `string[]` | `['text/plain']` | *(server)* Default output MIME modes advertised on the card. |
| `advertisedSkills` | `A2AAdvertisedSkill[]` | one `chat` skill | *(server)* Skills advertised on the card for discovery. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | *(client)* Remote agents registered as callable delegates. |
| `taskTimeoutSec` | `number` | `120` | *(client)* Per-task timeout when delegating to a remote agent. |

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and serve no interop surface.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate the transport layer calls:

- **`buildAgentCard(config, agentName?, agentVersion?)`** — construct the published A2A Agent Card, falling back to the agent's own identity for blank card fields and omitting `securitySchemes` when auth is `none`.
- **`buildSecuritySchemes(scheme)`** / **`transportLabel(transport)`** — map the config's auth scheme and transport onto A2A card fields.
- **`agentCardUrl(config)`** — resolve the absolute well-known card URL.
- **`validateAgentCard(value)`** — validate a fetched remote card, returning the narrowed card or the list of missing/malformed fields.
- **`A2A_TASK_STATES` / `isTerminalTaskState(state)` / `canTransition(from, to)`** — the task-state machine (submitted → working → completed/failed/canceled/rejected, with `input-required` / `auth-required` pauses).
- **`buildMessageSendRequest(opts)`** — shape a JSON-RPC 2.0 `message/send` request; **`parseTaskResult(response)`** interprets the reply (bare `Message` or `Task`, gathering text parts, surfacing JSON-RPC errors).
- **`remoteAgentToolSpec(remote)` / `delegateToolName(remote)`** — turn a registered remote agent into a callable delegate tool spec.
- **`activeRemoteDelegates(config)` / `shouldPublishCard(config)`** — role/enablement gates deciding which delegates to bind and whether to publish a card.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "role": "both",
  "protocolVersion": "0.3.0",
  "transport": "jsonrpc",
  "exposeAgentCard": true,
  "cardName": "Research Assistant",
  "cardDescription": "Answers research questions and cites sources.",
  "serverUrl": "https://research.example.com",
  "wellKnownPath": "/.well-known/agent-card.json",
  "streaming": true,
  "pushNotifications": false,
  "authScheme": "bearer",
  "inputModes": ["text/plain"],
  "outputModes": ["text/plain"],
  "advertisedSkills": [
    { "id": "research", "name": "Research", "description": "Answer questions with cited sources.", "tags": ["research", "web"] }
  ],
  "remoteAgents": [
    {
      "id": "weather",
      "name": "Weather Bot",
      "cardUrl": "https://weather.example.com/.well-known/agent-card.json",
      "transport": "jsonrpc",
      "enabledAsTool": true
    }
  ],
  "taskTimeoutSec": 120
}
```
