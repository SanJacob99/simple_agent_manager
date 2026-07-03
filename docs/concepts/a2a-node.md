# A2A (Agent-to-Agent) Node

> Exposes the agent over the Agent-to-Agent (A2A) protocol — publishing an Agent Card and accepting remote tasks — and/or registers remote A2A agents as callable delegates, giving cross-framework interop the in-process `agentComm` bus and in-tree `subAgent` cannot.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-03 -->

## Overview

`agentComm` is an in-process bus and `subAgent` is in-tree; neither lets this agent talk to agents built on *other* frameworks. The A2A protocol (agent cards, task/message envelopes, streaming updates) is the emerging lingua franca for cross-framework agent interop, much as MCP standardized tools. The A2A node activates two independently useful sides of that protocol:

- **Server** — publish an [Agent Card](https://a2a-protocol.org) at `<basePath>/.well-known/agent-card.json` and accept remote `message/send` tasks, exposing this agent to any A2A-speaking client.
- **Client** — register remote A2A agents (by their card URL) as callable delegates, so this agent can hand tasks to specialist agents on other stacks.

At most one A2A node binds to an agent — a single served card and a single delegate registry — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like Structured Output and Reflection).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Serving the card + a `message/send` handler under `basePath`, and dispatching delegated tasks to `remotes` (honouring `taskTimeoutMs` / `maxConcurrentTasks`), wired into `server/agents/run-coordinator.ts` and the Express app, is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no card is served and no remote is callable. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Which side(s) of the protocol this node activates. |
| `agentName` | `string` | `""` | Name published in the Agent Card. Empty falls back to the agent's own name. |
| `agentDescription` | `string` | `""` | Description published in the Agent Card. Empty falls back to the agent's description. |
| `publishSkills` | `boolean` | `true` | Advertise the agent's resolved skills as A2A skills in the card. |
| `transport` | `'jsonrpc' \| 'grpc' \| 'rest'` | `'jsonrpc'` | Preferred transport advertised in the card (`JSONRPC` / `GRPC` / `HTTP+JSON`). |
| `streaming` | `boolean` | `true` | Advertise SSE `message/stream` capability. |
| `pushNotifications` | `boolean` | `false` | Advertise `tasks/pushNotificationConfig` capability for long-running tasks. |
| `serverAuth` | `'none' \| 'apiKey' \| 'bearer' \| 'oauth2'` | `'bearer'` | Auth scheme the served endpoint requires from callers. |
| `basePath` | `string` | `"/a2a"` | Mount path for the A2A server. Normalized to a leading slash with no trailing slash. |
| `remotes` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents registered as callable delegates. |
| `taskTimeoutMs` | `number` | `120000` | Max wait for a remote task to reach a terminal state before giving up. |
| `maxConcurrentTasks` | `number` | `4` | Max remote tasks this agent runs concurrently. |

Each entry in `remotes` is an `A2ARemoteAgent`: `{ id, name, cardUrl, authScheme, credentialEnvVar }`. `cardUrl` may be a bare origin/base (resolved to the well-known card path) or an explicit `agent-card.json` URL. `credentialEnvVar` names the env var holding the token/key when `authScheme !== 'none'`.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`), normalizing `basePath`. Agents without one have `a2a === null` and neither serve a card nor delegate.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate:

- **`buildAgentCard(config, meta)`** — assembles the Agent Card served at the well-known path, using the node's name/description (falling back to the agent's own), the resolved capabilities, an optional skills list (when `publishSkills`), and a security scheme derived from `serverAuth`.
- **`normalizeBasePath(raw)` / `wellKnownCardPath(base)` / `resolveCardUrl(url)`** — the URL conventions for mounting and locating a card. A bare remote origin is extended to `<origin>/.well-known/agent-card.json`.
- **`isServer(config)` / `isClient(config)`** — role + enabled gating.
- **`validateRemote(remote)`** — validates a delegate's card URL and that a credential source is present when auth is required.
- **`buildMessageSendParams(text, opts)`** — constructs a JSON-RPC 2.0 `message/send` request to a remote (caller supplies `messageId` / `requestId`, keeping it pure).
- **`parseTaskResult(response)`** — parses the remote's response, handling a JSON-RPC error, a Task (with `status.state`, artifacts, history), and a bare Message; unknown shapes collapse to an `unknown` state rather than throwing.
- **`isTerminalState(state)`** — whether a task state (`completed` / `canceled` / `failed` / `rejected`) is terminal, for the client-side poll/stream loop.

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
  "agentDescription": "Answers research questions and delegates planning.",
  "publishSkills": true,
  "transport": "jsonrpc",
  "streaming": true,
  "pushNotifications": false,
  "serverAuth": "bearer",
  "basePath": "/a2a",
  "remotes": [
    {
      "id": "planr1",
      "name": "Planner",
      "cardUrl": "https://planner.example.com/a2a",
      "authScheme": "bearer",
      "credentialEnvVar": "PLANNER_TOKEN"
    }
  ],
  "taskTimeoutMs": 120000,
  "maxConcurrentTasks": 4
}
```
