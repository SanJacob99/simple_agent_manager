# A2A (Agent-to-Agent) Node

> Makes an agent interoperable with agents built on *other* frameworks: it publishes an A2A agent card and accepts inbound tasks (server), and/or registers remote A2A agents as callable delegates (client).

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-21 -->

## Overview

The A2A node adds cross-framework interop. The Agent-to-Agent (A2A) protocol — agent cards, task/message envelopes, and streaming task-state updates — is the emerging lingua franca for agents talking to agents, much as MCP standardized tools. Where the [Agent Comm node](agent-comm-node.md) is an in-process bus and the [Sub-Agent node](sub-agent-node.md) is in-tree, A2A lets this agent talk to agents running in entirely separate systems.

A single node covers both directions via `role`:

- **server** — publish an agent card at `cardPath` and accept inbound tasks, exposing this agent to remote callers.
- **client** — register remote A2A agents (each identified by its card URL) as callable delegates, turning each into a tool the agent can invoke.
- **both** — do each from one node.

At most one A2A node binds to an agent — it owns the agent's single card identity — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like [Structured Output](structured-output-node.md) / [Reflection](reflection-node.md)).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the server route (serve the card, accept `message/send` + `message/stream`, drive the task-state machine around `runtime.prompt()`) and the client path (register `buildDelegateTools` output through `server/tools/tool-factory.ts`, POST tasks to each `cardUrl`) into `server/a2a/` is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A"` | Human-readable label shown on the node. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Which side(s) of the protocol to enable. |
| `serverName` | `string` | `""` | Card name. Empty inherits the agent's own name. |
| `serverDescription` | `string` | `""` | Card description. Empty inherits the agent's own description. |
| `cardPath` | `string` | `"/.well-known/agent-card.json"` | Path the agent card is served from. |
| `streaming` | `boolean` | `true` | Advertise streaming task updates (SSE) in the card capabilities. |
| `pushNotifications` | `boolean` | `false` | Advertise push-notification support. |
| `stateTransitionHistory` | `boolean` | `false` | Advertise state-transition history. |
| `defaultInputModes` | `string[]` | `["text/plain"]` | MIME types the agent accepts as input. |
| `defaultOutputModes` | `string[]` | `["text/plain"]` | MIME types the agent emits as output. |
| `requireAuth` | `boolean` | `false` | Require a bearer token on inbound tasks. |
| `authTokenEnvVar` | `string` | `""` | Env var holding the accepted bearer token (never the token itself). |
| `delegates` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents to register as callable delegates. |
| `delegateToolPrefix` | `string` | `"a2a_"` | Prefix for generated delegate tool names. |
| `taskTimeoutMs` | `number` | `60000` | Per-delegated-task timeout in milliseconds. |

Each `A2ARemoteAgent` delegate has `id`, `name`, `cardUrl`, `description`, and `enabled`.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and neither publish a card nor gain delegate tools. The accepted bearer token is never resolved into the config — only `authTokenEnvVar` is carried, and the runtime reads the secret from the environment at request time so it never lands in a serialized graph.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate:

- **`A2A_PROTOCOL_VERSION`** — the protocol version advertised on the card.
- **`buildAgentCard(config, meta)`** — composes the agent card from the resolved config plus the agent's name / description / version / skills; `serverName` / `serverDescription` override the agent's own when set, and a bearer security scheme is advertised only when `requireAuth` is on.
- **`A2A_TASK_STATES` / `isTerminalTaskState` / `canTransition`** — the task lifecycle state machine (`submitted` → `working` → … → `completed` / `canceled` / `failed` / `rejected`) a server route drives as it processes a task.
- **`validateInboundMessage(raw)` / `createInboundTask(id, message)` / `messageToPromptText(message)`** — validate an inbound message envelope, wrap it in a fresh `submitted` task, and flatten its text parts into the prompt the runtime consumes.
- **`authorizeInbound(config, expectedToken, header)`** — bearer-token check that fails closed when auth is required but no token is configured.
- **`buildDelegateTools(config)`** — synthesizes one callable tool per enabled delegate (name = `delegateToolPrefix` + a slug of the delegate name, collisions disambiguated), which the tool factory registers.
- **`parseRemoteCard(raw)`** — validates and normalizes a card fetched from a delegate `cardUrl` for the client side.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "role": "both",
  "serverName": "Research Concierge",
  "serverDescription": "Plans and runs multi-step research tasks.",
  "cardPath": "/.well-known/agent-card.json",
  "streaming": true,
  "pushNotifications": false,
  "stateTransitionHistory": true,
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "requireAuth": true,
  "authTokenEnvVar": "A2A_INBOUND_TOKEN",
  "delegates": [
    {
      "id": "weather",
      "name": "Weather Agent",
      "cardUrl": "https://weather.example.com/.well-known/agent-card.json",
      "description": "Answer questions about current and forecast weather.",
      "enabled": true
    }
  ],
  "delegateToolPrefix": "a2a_",
  "taskTimeoutMs": 60000
}
```
