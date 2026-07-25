# A2A Interop Node

> Exposes this agent over the Agent-to-Agent (A2A) protocol — publish an agent card and accept remote tasks, and/or register remote A2A agents as callable delegates.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-25 -->

## Overview

The A2A node lets an agent speak the emerging **Agent-to-Agent (A2A) protocol**, the cross-framework interop standard for agents to discover and call one another — agent cards, JSON-RPC task/message envelopes, and streaming updates — much as MCP standardized tools. Where `agentComm` is an in-process bus and `subAgent` is in-tree, A2A reaches agents built on *other* frameworks.

Depending on its `role`, the node makes the agent an A2A **server** (publish an agent card at `serverPath`, accept remote `message/send` tasks), an A2A **client** (discover the agents in `remoteAgents` and delegate work to them as tools), or **both**. As a server it advertises declared `skills`, supported I/O `inputModes`/`outputModes`, streaming/push capabilities, and a security scheme in its card. As a client it registers each remote agent as a callable delegate.

At most one A2A node binds to an agent — it owns that agent's single published identity and its delegate registry — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like the [Reflection node](reflection-node.md)). It complements the [MCP node](mcp-node.md) (tool interop) with agent interop.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring it into the server (mount the card + JSON-RPC handler under `serverPath` in `server/index.ts`, register delegates as tools in `server/tools/tool-factory.ts`, fetch remote cards on startup, and stream task updates) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no card is served and no delegate is registered. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Whether the agent publishes a card, delegates to remote agents, or both. |
| `agentName` | `string` | `"Simple Agent"` | Name published in this agent's card (server role). |
| `agentDescription` | `string` | "An agent built with…" | Human-readable description published in the card. |
| `serverPath` | `string` | `"/a2a"` | Mount path the A2A server is served from. |
| `version` | `string` | `"0.1.0"` | Version string published in the card. |
| `advertiseStreaming` | `boolean` | `true` | Advertise SSE streaming (`message/stream`) capability in the card. |
| `advertisePushNotifications` | `boolean` | `false` | Advertise push-notification capability in the card. |
| `inputModes` | `string` | `"text/plain"` | Comma-separated MIME types accepted as input; split into an array on resolution. |
| `outputModes` | `string` | `"text/plain"` | Comma-separated MIME types produced as output; split into an array on resolution. |
| `authScheme` | `'none' \| 'bearer' \| 'apiKey' \| 'oauth2'` | `'none'` | Security scheme advertised on the served endpoint. |
| `skills` | `A2ASkillDescriptor[]` | `[]` | Skills declared in the published card (`id`, `name`, `description`, comma-separated `tags`). |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents registered as callable delegates (`id`, `name`, `cardUrl`, `authScheme`). |
| `forwardArtifacts` | `boolean` | `true` | Forward artifacts returned by a remote agent back to the caller. |

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`), splitting the comma-separated `inputModes`, `outputModes`, and skill `tags` strings into arrays that match the A2A `AgentCard` schema. Agents without one have `a2a === null`.

`server/a2a/a2a-engine.ts` provides the protocol substrate (dependency-free; performs no network I/O so it stays unit-testable):

- **`buildAgentCard(config, baseUrl?)`** — assemble the JSON agent card (name, description, `protocolVersion`, capabilities, default I/O modes, skills, security schemes); sets an absolute `url` when a base URL is known.
- **`buildMessageSendParams(text, opts)`** / **`buildJsonRpcRequest(method, params, id)`** — build the JSON-RPC `message/send` envelope handed to a remote agent (message ids supplied by the caller so the builder stays deterministic).
- **`parseTaskResult(response)`** — normalize a remote reply into `{ state, text, artifacts, error }`, handling both a bare `Message` and a `Task` (with `status.state`, `artifacts`, `history`); malformed input collapses to an empty result rather than throwing.
- **`toDelegateDescriptors(config)`** — turn registered remote agents into callable delegate descriptors (`a2a_delegate_<slug>` tool names); empty for a disabled node or a pure server, and drops delegates with a blank `cardUrl`.
- **`normalizeCardUrl(url)`**, **`isTerminalState(state)`**, **`servesCard(config)`** — card-URL, task-state, and role helpers.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Cross-framework interop",
  "enabled": true,
  "role": "both",
  "agentName": "Research Agent",
  "agentDescription": "Answers research questions and cites sources.",
  "serverPath": "/a2a",
  "version": "1.0.0",
  "advertiseStreaming": true,
  "advertisePushNotifications": false,
  "inputModes": "text/plain",
  "outputModes": "text/plain, application/json",
  "authScheme": "bearer",
  "skills": [
    { "id": "research", "name": "Research", "description": "Deep research with citations", "tags": "web, rag" }
  ],
  "remoteAgents": [
    { "id": "coder", "name": "Coder", "cardUrl": "https://coder.example/.well-known/agent-card.json", "authScheme": "bearer" }
  ],
  "forwardArtifacts": true
}
```
