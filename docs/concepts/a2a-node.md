# A2A Interop Node

> Exposes the agent over the Agent-to-Agent (A2A) protocol and/or registers remote A2A agents as callable delegates, so it can interoperate with agents built on other frameworks.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-26 -->

## Overview

The A2A node connects this agent to the broader agent ecosystem. `agentComm` is an in-process bus and `subAgent` is in-tree; neither lets this agent talk to agents built on *other* frameworks. The [Agent-to-Agent (A2A) protocol](https://a2a-protocol.org/v0.3.0/specification/) is the emerging lingua franca for cross-framework interop, much as MCP standardized tools: a server publishes a self-describing **agent card** at `/.well-known/agent-card.json`, and callers hand it work with a JSON-RPC 2.0 `message/send` (or streaming `message/stream`) envelope, receiving a `Task` or `Message` back.

A single node covers both directions via `exposureMode`:

- **Server** — publish an agent card (name, description, skills, capabilities, security schemes) and accept remote tasks.
- **Client** — register remote A2A agents as delegates and route tasks to them, optionally via an `a2a_delegate` tool the agent can call itself.
- **Both** — do each from the same node.

It complements the [MCP node](mcp-node.md) (tool interop) and [Sub-Agent node](sub-agent-node.md) (in-tree delegation): A2A is delegation *across* framework and process boundaries.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Serving the card over HTTP, POSTing delegated tasks, exposing the `a2a_delegate` tool, and streaming `tasks/get` updates from `server/a2a/` is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no card is served and no delegate is callable. |
| `exposureMode` | `'server' \| 'client' \| 'both'` | `'both'` | Whether this agent is an A2A server, client, or both. |
| `serverName` | `string` | `""` | `name` on the published agent card. Empty falls back to the agent's name. |
| `serverDescription` | `string` | `""` | `description` on the published agent card. Empty falls back to the agent's description. |
| `serverUrl` | `string` | `""` | Base URL the card advertises (where remote agents reach this agent). |
| `advertisedSkills` | `string[]` | `[]` | Skill ids advertised on the card. Empty derives them from the agent's tools/skills. |
| `supportsStreaming` | `boolean` | `true` | Advertise `message/stream` (SSE task updates) support on the card. |
| `serverAuth` | `'none' \| 'apiKey' \| 'bearer' \| 'oauth2'` | `'none'` | Security scheme the server requires from callers. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents registered as callable delegates. |
| `exposeDelegateTool` | `boolean` | `true` | Expose an `a2a_delegate` tool so the agent can hand a task to a remote agent. |
| `taskTimeoutMs` | `number` | `120000` | Per-delegated-task timeout in milliseconds. |

Each `A2ARemoteAgent` carries `id`, `name`, `url`, `cardUrl` (optional override of the well-known path), `skills`, `auth`, `credentialEnvVar` (env var holding the token/key), and `enabled`.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and neither publish a card nor delegate.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate (no network I/O; ids are caller-supplied so the surface stays pure):

- **`buildAgentCard(config, fallback)`** — assemble the agent card this agent publishes, filling blank node fields from the agent's own name/description/skills and deduping skill ids.
- **`validateAgentCard(card)`** — check a card carries the A2A-required fields; used for both the published card and a fetched remote card.
- **`parseRemoteAgentCard(input)`** — parse/validate a remote card (raw JSON or object) into a normalized `A2AAgentCard`.
- **`cardUrlFor(remote)`** — resolve a remote's card URL (`cardUrl` override, else base URL + `/.well-known/agent-card.json`).
- **`buildMessageSendRequest(content, opts)`** — construct the JSON-RPC `message/send` / `message/stream` envelope that delegates a task.
- **`normalizeMessageParts(input)`** — normalize a string or loose parts into A2A message parts.
- **`parseTaskResult(response)`** — extract text + state + artifacts from a `Task`/`Message` JSON-RPC reply, or surface a JSON-RPC error.
- **`selectDelegate(remotes, need)` / `scoreDelegateMatch(remote, need)`** — pick the best enabled remote for a delegation need by skill/name match.
- **`resolveAuthHeader(scheme, credential)`** — build the HTTP auth header for a scheme.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "exposureMode": "both",
  "serverName": "Research Concierge",
  "serverDescription": "Answers research questions and delegates specialized work.",
  "serverUrl": "https://concierge.example.com/a2a",
  "advertisedSkills": ["research", "summarize"],
  "supportsStreaming": true,
  "serverAuth": "bearer",
  "remoteAgents": [
    {
      "id": "translator",
      "name": "Translation Agent",
      "url": "https://translate.example.com",
      "cardUrl": "",
      "skills": ["translate"],
      "auth": "apiKey",
      "credentialEnvVar": "TRANSLATE_API_KEY",
      "enabled": true
    }
  ],
  "exposeDelegateTool": true,
  "taskTimeoutMs": 120000
}
```
