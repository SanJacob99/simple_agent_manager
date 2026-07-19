# A2A Interop Node

> Speaks the Agent-to-Agent (A2A) protocol: exposes this agent as an A2A server (publish an agent card, accept remote tasks) and/or registers remote A2A agents as callable delegates.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-19 -->

## Overview

`agentComm` is an in-process bus and `subAgent` is in-tree — neither lets this agent talk to agents built on *other* frameworks. The A2A node bridges that gap. The emerging Agent-to-Agent (A2A) protocol — agent cards, task/message envelopes, and streaming updates — is becoming the lingua franca for cross-framework agent interop, much as MCP standardized tools.

The node turns on either or both sides of the protocol via `mode`:

- **Server** — publish an A2A agent card (name, description, version, advertised skills, capabilities) at `${baseUrl}/.well-known/agent-card.json` and accept remote `message/send` tasks against a mount path. Other frameworks' agents can then discover and delegate to this one.
- **Client** — register remote A2A agents as callable delegates. The agent can pick a remote by id, name, or capability and hand it a task.

At most one A2A node binds to an agent, so it resolves to a single optional value on `AgentConfig.a2a` (like Structured Output and Reflection). It complements the [Agent Comm node](agent-comm-node.md) (in-process peer bus) and [MCP node](mcp-node.md) (tool interop) by covering cross-framework *agent* interop.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the backend (mount an A2A router at `server.path`, drive a headless run per accepted task, register remotes as delegate tools, emit task events) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but neither side is active. |
| `mode` | `'server' \| 'client' \| 'both'` | `'both'` | Which protocol sides are turned on. |
| `agentName` | `string` | `""` | Name published in the agent card. Empty falls back to the connected agent's name. |
| `agentDescription` | `string` | `""` | Description published in the agent card. Empty falls back to the agent's description. |
| `agentVersion` | `string` | `"1.0.0"` | Agent card version string. |
| `serverPath` | `string` | `"/a2a"` | Mount path for the A2A endpoint on the local backend. |
| `advertiseStreaming` | `boolean` | `true` | Advertise `message/stream` (SSE task updates) in the card capabilities. |
| `advertisePushNotifications` | `boolean` | `false` | Advertise push-notification (webhook) task updates. |
| `requireAuth` | `boolean` | `false` | Require a bearer token on incoming task requests. |
| `exposedSkills` | `A2ASkillAdvertisement[]` | `[]` | Skills advertised in the agent card (`id`, `name`, `description`, `tags`). |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents registered as delegates (`id`, `name`, `url`, `description`). |
| `defaultTimeoutMs` | `number` | `60000` | Default per-task timeout for remote calls, in milliseconds. |
| `maxConcurrentTasks` | `number` | `4` | Max remote A2A tasks in flight at once. |
| `onError` | `'fail' \| 'warn' \| 'ignore'` | `'warn'` | What the client side does when a remote call fails or times out. |

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`), splitting the flat node data into a `server` sub-object and a `client` sub-object. The server side falls back to the connected agent's `name`/`description` when the node leaves those blank. Agents without an A2A node have `a2a === null`.

`server/a2a/a2a-engine.ts` provides the protocol substrate (dependency-free, transport-agnostic):

- **`buildAgentCard(config, baseUrl)`** — builds the spec-shaped agent card published at the well-known path; adds a bearer security scheme only when `requireAuth` is set.
- **`parseRpcRequest(raw, config)`** — validates the JSON-RPC 2.0 envelope, the method (`message/send`, `message/stream`, `tasks/get`, `tasks/cancel`), and refuses streaming when the server does not advertise it.
- **`parseIncomingMessage(params)` / `messageToPrompt(message)`** — extract and flatten a user message's text parts into a headless-run prompt.
- **`buildTask` / `advanceTask` / `isTerminalState` / `canTransition`** — the task-state machine (`submitted → working → input-required → completed/canceled/failed/rejected`), refusing illegal transitions.
- **`selectDelegate(config, query)`** — client-side delegate selection by id, name, or capability.
- **`buildDelegateRequest` / `buildJsonRpcResult` / `buildJsonRpcError` / `effectiveTimeoutMs`** — outbound request and response-envelope helpers.

The remaining integration step wires this into an Express/SSE router under `server/a2a/`, drives a headless ephemeral run per accepted task, registers each remote as a delegate tool, and emits `a2a:task` lifecycle events.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Research A2A",
  "enabled": true,
  "mode": "both",
  "agentName": "Research Agent",
  "agentDescription": "Answers deep research questions with citations.",
  "agentVersion": "1.2.0",
  "serverPath": "/a2a",
  "advertiseStreaming": true,
  "advertisePushNotifications": false,
  "requireAuth": true,
  "exposedSkills": [
    { "id": "summarize", "name": "Summarize", "description": "Summarize a document", "tags": ["text", "nlp"] }
  ],
  "remoteAgents": [
    { "id": "coder", "name": "Coder", "url": "https://coder.example.com/a2a", "description": "Writes and edits code" }
  ],
  "defaultTimeoutMs": 60000,
  "maxConcurrentTasks": 4,
  "onError": "warn"
}
```
