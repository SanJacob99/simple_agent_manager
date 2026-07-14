# A2A Interop Node

> Exposes the agent over the Agent-to-Agent (A2A) protocol — publishing an Agent Card and accepting remote tasks — and/or registers remote A2A agents as callable delegates, giving cross-framework agent interop.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-14 -->

## Overview

The A2A node connects this agent to agents built on *other* frameworks. A2A (Agent-to-Agent) is the emerging cross-framework standard for agents to discover and task one another: a server publishes an **Agent Card** describing its identity, endpoint, capabilities, and skills, and peers exchange **message/task envelopes** over JSON-RPC, optionally streaming updates over SSE. Where MCP standardized *tools*, A2A standardizes *agents talking to agents*.

The node has two independent surfaces:

- **Server** — when `exposeAsServer` is set, this agent publishes an Agent Card (served at `<serverPath>/.well-known/agent-card.json`) and accepts inbound tasks from remote A2A clients.
- **Client** — `remoteAgents` registers remote A2A peers by their Agent Card URL so this agent can delegate tasks to them.

This complements the in-process [`agentComm`](agent-comm-node.md) bus and the in-tree [`subAgent`](sub-agent-node.md) executor, both of which stay inside this builder. A2A reaches agents on other stacks (LangGraph, CrewAI, ADK, custom servers).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the HTTP surface (an Express route that serves the card, accepts `message/send` + `message/stream`, and drives a headless run per task through `server/agents/run-coordinator.ts`) and the outbound delegate client is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no A2A surface is served and no peers are registered. |
| `exposeAsServer` | `boolean` | `true` | Publish an Agent Card and accept inbound tasks from remote A2A clients. |
| `agentName` | `string` | `"Simple Agent"` | Name advertised in the Agent Card. |
| `agentDescription` | `string` | "An agent built with…" | Description advertised in the Agent Card. |
| `serverPath` | `string` | `"/a2a"` | Mount path the A2A endpoint is served from. |
| `version` | `string` | `"0.1.0"` | Version string advertised in the Agent Card. |
| `streaming` | `boolean` | `true` | Advertise streaming (SSE `message/stream`) support in `capabilities`. |
| `pushNotifications` | `boolean` | `false` | Advertise push-notification (webhook) support in `capabilities`. |
| `stateTransitionHistory` | `boolean` | `true` | Advertise task state-transition history in `capabilities`. |
| `defaultInputModes` | `string[]` | `["text/plain"]` | MIME/mode strings the agent accepts. |
| `defaultOutputModes` | `string[]` | `["text/plain"]` | MIME/mode strings the agent produces. |
| `publishSkills` | `boolean` | `true` | Publish the agent's connected Skills as A2A skills on the card. |
| `authScheme` | `'none' \| 'bearer' \| 'apiKey'` | `'none'` | How remote peers authenticate to the server. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A peers (`{ name, cardUrl, description }`) registered as delegates. |

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). At most one A2A node binds to an agent; agents without one have `a2a === null`.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate:

- **`buildAgentCard(config, baseUrl, skills)`** — constructs the published Agent Card (protocol version, name, endpoint URL, `capabilities`, input/output modes, security schemes, skills). Returns `null` when A2A is disabled or the server surface is not exposed.
- **`agentCardUrl(config, baseUrl)`** — the `/.well-known/agent-card.json` discovery URL.
- **`buildSecuritySchemes(config)`** — maps `authScheme` to an A2A `securitySchemes` object (or `null`).
- **`validateIncomingMessage(raw)`** — validates an inbound message envelope (`role`, non-empty `parts`, part `kind`), lenient on unknown fields so newer part kinds pass through.
- **`extractMessageText(message)`** — concatenates the text parts of a message.
- **`canTransition(from, to)` / `isTerminalState(state)`** — the A2A task-state machine (`submitted → working → input-required / auth-required → completed / canceled / failed / rejected`).
- **`selectRemoteAgent(config, name)`** — resolves a registered remote delegate by its local alias.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired. The `publishSkills` option reads the agent's connected [Skills](skill-node.md).

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "exposeAsServer": true,
  "agentName": "Research Assistant",
  "agentDescription": "Answers research questions with cited sources.",
  "serverPath": "/a2a",
  "version": "1.0.0",
  "streaming": true,
  "pushNotifications": false,
  "stateTransitionHistory": true,
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "publishSkills": true,
  "authScheme": "bearer",
  "remoteAgents": [
    {
      "name": "summarizer",
      "cardUrl": "https://peer.example/a2a/.well-known/agent-card.json",
      "description": "A remote agent that condenses long documents."
    }
  ]
}
```
