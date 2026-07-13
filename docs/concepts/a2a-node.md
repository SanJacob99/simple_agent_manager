# A2A Interop Node

> Gives the agent a cross-framework interop surface built on the emerging Agent-to-Agent (A2A) protocol: publish an agent card and accept remote tasks (server), and/or register remote A2A agents as callable delegates (client).

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-13 -->

## Overview

Where the [Agent Comm node](agent-comm-node.md) is an in-process bus and the [Sub-Agent node](sub-agent-node.md) is in-tree, the A2A node lets this agent talk to agents built on *other* frameworks. It speaks the emerging **Agent-to-Agent (A2A) protocol** — agent cards, task/message envelopes, and streaming status updates — which is becoming the cross-framework lingua franca for agents, much as MCP standardized tools.

The node has two independent halves, either or both of which may be active:

- **Server:** publish this agent as an A2A server — expose an agent card at `<serverPath>/.well-known/agent-card.json` and accept inbound remote tasks.
- **Client:** register remote A2A agents (`remotes`) as callable delegates; the runtime fetches each remote's card, validates it, and can send it tasks.

At most one A2A node binds to an agent — it owns both the published server identity and the remote delegate registry — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like Structured Output and Reflection).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the HTTP/SSE server surface under `serverPath`, the remote-card fetch, and the delegate tool into `server/agents/run-coordinator.ts` is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end. See `docs/roadmap/2026-modernization.md`.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no A2A surface is active. |
| `exposeAsServer` | `boolean` | `false` | Publish an agent card and accept inbound remote tasks. |
| `agentName` | `string` | `"Simple Agent"` | Name advertised on the published agent card. |
| `agentDescription` | `string` | "An agent built with…" | One-line description advertised on the card. |
| `version` | `string` | `"1.0.0"` | Semantic version string for the published card. |
| `serverPath` | `string` | `"/a2a"` | Base path the A2A endpoint is mounted at. |
| `streaming` | `boolean` | `true` | Advertise streaming (SSE) task updates in the card's capabilities. |
| `defaultInputModes` | `string[]` | `["text"]` | Default input content types advertised on the card. |
| `defaultOutputModes` | `string[]` | `["text"]` | Default output content types advertised on the card. |
| `remotes` | `A2ARemoteAgent[]` | `[]` | Remote agents registered as callable delegates. |
| `authScheme` | `'none' \| 'bearer' \| 'apiKey'` | `'none'` | Auth scheme applied to outbound delegate calls. |
| `taskTimeoutMs` | `number` | `60000` | Per-task wall-clock timeout for outbound delegate calls, in milliseconds. |

Each `remotes` entry is `{ id, name, cardUrl, enabled }` — `cardUrl` points at the remote's agent card (e.g. `…/.well-known/agent-card.json`), and `id` doubles as the delegate name.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and publish no card / register no delegates.

`server/a2a/a2a-engine.ts` provides the protocol substrate (dependency-free; the transport is the runtime's job):

- **`buildAgentCard(config, baseUrl, skills)`** — assembles the spec-shaped `AgentCard` (protocol version, name, description, url, capabilities, default modes, skills) served to remote agents.
- **`validateAgentCard(card)`** — checks a fetched remote card for the required fields before it is trusted as a delegate; returns the list of problems.
- **`parseIncomingMessage(raw)`** — normalizes an inbound `message/send` payload (wrapped or bare) into an `A2AMessage`, or returns `{ error }` when no text message can be recovered.
- **`extractText(message)`** — concatenates the text of every `text` part in a message.
- **`buildTask(request, ids)` / `advanceTask(task, state, agentMessage?)`** — open and progress a task through `submitted → working → completed | failed`, refusing to advance out of a terminal state.
- **`selectRemote(config, idOrName)` / `listDelegates(config)`** — resolve an enabled remote delegate by id or name, or list them in configuration order.
- **`authHeaders(scheme, credential)`** — build the outbound auth headers (bearer / api-key) for a delegate call, or none for an open endpoint.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "exposeAsServer": true,
  "agentName": "Research Orchestrator",
  "agentDescription": "Plans and delegates research tasks across specialist agents.",
  "version": "2.1.0",
  "serverPath": "/a2a",
  "streaming": true,
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "remotes": [
    {
      "id": "planner",
      "name": "Planner Agent",
      "cardUrl": "https://planner.example.com/.well-known/agent-card.json",
      "enabled": true
    }
  ],
  "authScheme": "bearer",
  "taskTimeoutMs": 120000
}
```
