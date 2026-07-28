# A2A Interop Node

> Exposes this agent as an Agent-to-Agent (A2A) server — publishing an agent card and accepting remote tasks — and/or registers remote A2A agents as callable delegates. The A2A protocol is the emerging cross-framework standard for agent interop, much as MCP standardized tools.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-28 -->

## Overview

`agentComm` is an in-process bus and `subAgent` is in-tree; neither lets this agent talk to agents built on *other* frameworks. The A2A node adds a network-standard boundary. It has two sides, selected by `role`:

- **Server** — publish an [agent card](https://a2a-protocol.org) at `<serverUrl>/.well-known/agent-card.json` describing this agent's name, capabilities, transports, auth, and advertised skills, and accept task/message envelopes from remote callers.
- **Client** — register remote A2A agents (each resolved from its own card URL) as delegates this agent can hand subtasks to, optionally exposing each as a callable tool the model can invoke by name.
- **Both** — do each from one node.

Each connected A2A node contributes one interop surface, so a graph can carry a server-exposure node alongside one or more client-delegation nodes. They resolve to a **list** on `AgentConfig.a2a` (like Evals and Budgets), not a single value.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. The network layer — an Express router that serves the card and terminates the A2A task/message endpoint, plus a client that performs the JSON-RPC / gRPC / HTTP+JSON call to a remote agent — is the remaining integration step. Nothing in the engine opens a socket or reads a secret: `authRef` stays a reference and the runtime resolves the actual credential out of band. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but neither side is active. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Which side(s) of the protocol this node turns on. |
| `agentName` | `string` | `""` | Card `name` (server role). Empty falls back to the agent's own name at serve time. |
| `agentDescription` | `string` | `""` | Card description shown to remote clients. |
| `serverUrl` | `string` | `""` | Base URL the card and task endpoint are served from. |
| `cardVersion` | `string` | `"1.0.0"` | Version string advertised on the card. |
| `advertisedSkills` | `A2ASkillAdvertisement[]` | `[]` | Capabilities published on the card (`id`, `name`, `description`, `tags`). |
| `streaming` | `boolean` | `true` | Advertise Server-Sent-Events streaming support on the card. |
| `pushNotifications` | `boolean` | `false` | Advertise push-notification (webhook) support on the card. |
| `serverAuthScheme` | `'none' \| 'apiKey' \| 'bearer' \| 'oauth2'` | `'none'` | How remote callers authenticate to this agent's endpoint. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents this agent can delegate to (client role). |
| `defaultTransport` | `'jsonrpc' \| 'grpc' \| 'http+json'` | `'jsonrpc'` | Transport used for remote agents that do not pin their own. |

Each `A2ARemoteAgent` carries `id`, `name`, `cardUrl`, `transport`, `authScheme`, `authRef` (a credential *reference*, never the secret value), and `exposeAsTool`.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves every connected A2A node into a `ResolvedA2AConfig` on the `AgentConfig.a2a` list (`shared/agent-config.ts`). Agents without one have `a2a` omitted or empty and expose no A2A surface.

`server/a2a/a2a-engine.ts` provides the interop substrate (dependency-free and side-effect-free):

- **`buildAgentCard(config, fallbackName)`** — the serializable agent card the server role publishes; `agentName` falls back to `fallbackName` when blank.
- **`cardUrlFor(config)`** — the absolute card URL (`<serverUrl>/.well-known/agent-card.json`), or `null` when no `serverUrl` anchors it.
- **`servesCard(config)` / `delegatesRemotely(config)`** — the role predicates (both `false` when disabled).
- **`validateA2AConfig(config)`** — the blocking issues that would stop a surface from standing up (missing server URL, duplicate skill/agent ids, remote agent missing a card URL or an auth ref its scheme requires). Disabled configs are always valid.
- **`transportFor(config, remote)`** — the transport for a remote call: the remote's pin, else the node default.
- **`buildDelegateTools(config)`** — one tool descriptor per remote agent with `exposeAsTool` set, named `a2a_delegate_<id>`, for the tool factory to adopt so the model can delegate by name.

## Connections

Peripheral → Agent. Multiple A2A nodes may bind to one Agent; each contributes an independent interop surface to the resolved `a2a` list.

## Example

```json
{
  "type": "a2a",
  "label": "Interop boundary",
  "enabled": true,
  "role": "both",
  "agentName": "Research Concierge",
  "agentDescription": "Answers research questions and delegates planning.",
  "serverUrl": "https://agents.example.com/research",
  "cardVersion": "1.2.0",
  "advertisedSkills": [
    { "id": "research", "name": "Deep research", "description": "Multi-source research with citations", "tags": ["research", "web"] }
  ],
  "streaming": true,
  "pushNotifications": false,
  "serverAuthScheme": "bearer",
  "remoteAgents": [
    {
      "id": "planner",
      "name": "Planner Agent",
      "cardUrl": "https://planner.example.com/.well-known/agent-card.json",
      "transport": "jsonrpc",
      "authScheme": "apiKey",
      "authRef": "PLANNER_API_KEY",
      "exposeAsTool": true
    }
  ],
  "defaultTransport": "jsonrpc"
}
```
