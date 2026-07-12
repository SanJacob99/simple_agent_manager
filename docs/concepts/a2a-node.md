# A2A Interop Node

> Exposes this agent over the Agent-to-Agent (A2A) protocol — publishing an agent card and accepting remote tasks, and/or registering remote A2A agents as callable delegates — so it can interoperate with agents built on other frameworks.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-12 -->

## Overview

The A2A node lets this agent talk to — and be talked to by — agents built on *other* frameworks. Where the [Agent Comm node](agent-comm-node.md) is an in-process bus and the [Sub-Agent node](sub-agent-node.md) runs agents in-tree, neither crosses a framework boundary. The emerging **Agent-to-Agent (A2A)** protocol fills that gap: agents publish a JSON **agent card** describing their skills and endpoints, and exchange work as JSON-RPC 2.0 **task/message** envelopes (`message/send`, `message/stream`, `tasks/get`, `tasks/cancel`). It is the cross-framework analogue of MCP — where MCP standardized *tools*, A2A standardizes *agents*.

The node has two sides, selected by `role`:

- **Server** — publish this agent's card at `/.well-known/agent-card.json` and accept inbound tasks. Configure the advertised name, description, version, skills, streaming/push capabilities, and inbound auth scheme.
- **Client** — register remote A2A agents as callable delegates. Each remote resolves to a delegate tool named `a2a_<id>` that the agent can call to hand a subtask to that remote.

At most one A2A node binds to an agent — it owns the single published card and the delegate registry — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like [Reflection](reflection-node.md) / [Structured Output](structured-output-node.md)).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring it into the server — serving the card route from `isServerEnabled` + `buildAgentCard`, registering the `resolveDelegates` tools, and pumping the JSON-RPC transport for `buildMessageSendRequest` / `parseTaskResponse` — is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` no card is served and no delegate is registered. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Whether this agent publishes its card, delegates to remotes, or both. |
| `agentName` | `string` | `""` | Name advertised on the published card. Empty falls back to `label`. |
| `agentDescription` | `string` | `""` | Description advertised on the card. |
| `agentVersion` | `string` | `"0.1.0"` | Version string for the card. |
| `advertisedSkills` | `A2ASkillAdvert[]` | `[]` | Skills advertised on the card (`{ id, name, description }`). |
| `streaming` | `boolean` | `true` | Advertise SSE streaming (`message/stream`) support. |
| `pushNotifications` | `boolean` | `false` | Advertise webhook push-notification support. |
| `serverAuthScheme` | `'none' \| 'apiKey' \| 'bearer' \| 'oauth2'` | `'none'` | Auth scheme advertised for inbound calls. |
| `remotes` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents registered as delegates (`{ id, name, url, authScheme, enabled }`). |
| `taskTimeoutMs` | `number` | `120000` | Timeout for a delegated remote task before it is abandoned. |
| `maxConcurrentTasks` | `number` | `2` | Cap on remote tasks running at once across all delegates. |

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null`.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate (no I/O; message ids are injected so it stays deterministic and testable):

- **`buildAgentCard(config, { url })`** / **`validateAgentCard(card)`** — construct and check the card this agent publishes; `buildSecuritySchemes` maps the auth scheme to the OpenAPI-style `securitySchemes` / `security` pair the card format uses.
- **`isServerEnabled(config)` / `isClientEnabled(config)`** — gate each side on `role` + `enabled`.
- **`resolveDelegates(config)`** — turn the enabled remotes into delegate descriptors (`toolName`, `cardUrl`, auth); **`selectRemoteById`** looks one up.
- **`buildMessageSendRequest(text, { messageId, streaming })`** — frame an outbound JSON-RPC `message/send` (or `message/stream`) task; **`buildJsonRpcRequest`** / **`buildMessageParams`** are the lower-level builders.
- **`parseTaskResponse(raw)`** — normalize a remote reply (JSON-RPC error, direct `message`, or `task` with a status + artifacts) into `{ taskId, state, text, isTerminal, error }`; **`normalizeState`** / **`isTerminalState`** classify the task state.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "role": "both",
  "agentName": "Billing Assistant",
  "agentDescription": "Resolves billing and subscription questions.",
  "agentVersion": "1.0.0",
  "advertisedSkills": [
    { "id": "billing", "name": "Billing", "description": "Resolve billing issues." }
  ],
  "streaming": true,
  "pushNotifications": false,
  "serverAuthScheme": "bearer",
  "remotes": [
    { "id": "research", "name": "Research Agent", "url": "https://research.example", "authScheme": "apiKey", "enabled": true }
  ],
  "taskTimeoutMs": 120000,
  "maxConcurrentTasks": 2
}
```
