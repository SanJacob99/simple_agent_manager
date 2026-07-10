# A2A Node

> Exposes this agent to — and lets it call — agents built on *other* frameworks over the emerging Agent-to-Agent (A2A) protocol: a published agent card, task/message envelopes, and streaming task updates. The cross-framework lingua franca, much as MCP standardized tools.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-10 -->

## Overview

`agentComm` is an in-process bus and `subAgent` is in-tree; neither lets this agent talk to agents built on other frameworks. The A2A node closes that gap. It has two independent halves that can be enabled together or separately:

- **Server** — publish an [agent card](https://a2a-protocol.org) (a JSON document served at `/.well-known/agent-card.json`) describing the agent's identity, capabilities, skills, and security, and accept inbound A2A tasks (`message/send`, `message/stream`, `tasks/get`, `tasks/cancel`).
- **Client** — register remote A2A agents as callable delegates. The runtime fetches each remote's card and can hand it tasks.

At most one A2A node binds to an agent — it defines the single cross-framework boundary — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like [Structured Output](structured-output-node.md) and [Reflection](reflection-node.md)).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the agent-card route and task endpoints into the server (`server/a2a/`) and registering remote delegates as callable tools in `server/agents/run-coordinator.ts` is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but neither half is active. |
| `exposeAsServer` | `boolean` | `true` | Publish an agent card and accept inbound A2A tasks. |
| `agentName` | `string` | `""` | Card `name`. Empty falls back to the agent's own name. |
| `agentDescription` | `string` | `""` | Card `description`, shown to remote callers. |
| `version` | `string` | `"0.1.0"` | Card `version` — the agent's own version, not the protocol version. |
| `serverUrl` | `string` | `"http://localhost:3001/a2a"` | Base URL the card advertises for the A2A endpoint. |
| `transport` | `'jsonrpc' \| 'grpc' \| 'rest'` | `'jsonrpc'` | Wire transport the endpoint speaks. |
| `streaming` | `boolean` | `true` | Advertise SSE streaming (`message/stream`, `tasks/resubscribe`). |
| `pushNotifications` | `boolean` | `false` | Advertise webhook-based task update notifications. |
| `authScheme` | `'none' \| 'apiKey' \| 'bearer' \| 'oauth2'` | `'none'` | Security scheme the card advertises for inbound calls. |
| `defaultInputModes` | `string[]` | `['text/plain']` | Accepted inbound content types (card `defaultInputModes`). |
| `defaultOutputModes` | `string[]` | `['text/plain']` | Produced outbound content types (card `defaultOutputModes`). |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents this agent can delegate tasks to. |

Each `remoteAgents` entry has `id`, `name`, `cardUrl` (the remote's `/.well-known/agent-card.json`), and `enabled`.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`), dropping disabled remote delegates so the resolved config only carries live ones. Agents without an A2A node have `a2a === null`.

`server/runtime/a2a-engine.ts` provides the interop substrate (dependency-free; it never touches the network):

- **`buildAgentCard(config, fallbackName, skills)`** — assembles the published `A2AAgentCard`, including `protocolVersion` (`A2A_PROTOCOL_VERSION`), capabilities, deduped input/output modes, skills, and the security block.
- **`buildSecuritySchemes(scheme)`** — maps the auth scheme to OpenAPI-style `securitySchemes` + `security` requirements (`none` advertises nothing).
- **`isTerminalState(state)` / `canTransition(from, to)`** — the A2A task lifecycle (`submitted → working → input-required → completed | canceled | failed | rejected`) and its legal transitions.
- **`validateTaskEnvelope(raw)`** — validates and normalizes an inbound `message/send` params object into an `A2AMessage`, tolerating bare-string parts and reporting field-level errors.
- **`selectRemoteAgent(config, id)` / `callableDelegates(config)`** — pick an enabled remote delegate by id, or list the delegates the agent can actually call.
- **`isServerExposed(config)`** — whether the config exposes a usable A2A server (enabled, exposing, and given an endpoint URL).

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "exposeAsServer": true,
  "agentName": "Research Concierge",
  "agentDescription": "Answers research questions and can hand off planning to a peer agent.",
  "version": "1.0.0",
  "serverUrl": "https://agents.example.com/research/a2a",
  "transport": "jsonrpc",
  "streaming": true,
  "pushNotifications": false,
  "authScheme": "bearer",
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain"],
  "remoteAgents": [
    {
      "id": "planner",
      "name": "Planner Agent",
      "cardUrl": "https://planner.example.com/.well-known/agent-card.json",
      "enabled": true
    }
  ]
}
```
