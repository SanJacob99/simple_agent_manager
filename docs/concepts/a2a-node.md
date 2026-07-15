# A2A (Agent-to-Agent Interop) Node

> Exposes the agent as an A2A server (publishes an agent card, accepts remote tasks) and/or registers remote A2A agents as callable delegates — the emerging cross-framework interop protocol, much as MCP standardized tools.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-15 -->

## Overview

`agentComm` is an in-process bus and `subAgent` is in-tree; neither lets this agent talk to agents built on *other* frameworks. The Agent-to-Agent (A2A) protocol standardizes cross-framework interop the way MCP standardized tools: a server publishes an **agent card** (JSON metadata at a well-known path describing its skills and capabilities), and clients send it work as JSON-RPC `message/send` requests carrying message/part envelopes.

The A2A node participates in one of three `role`s:

- **server** — publish this agent as an A2A endpoint: serve an agent card and accept remote tasks, making the agent callable by other frameworks.
- **client** — register remote A2A agents as callable delegates (optionally exposed to the model as `a2a_send_*` tools).
- **both** — do both at once.

Each connected A2A node resolves to its own entry on `AgentConfig.a2a` (a list, like Telemetry and Guardrails), so a graph can carry a server node and several client nodes at the same time.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring an A2A server route into `server/index.ts` (serve the card built by `buildAgentCard`, route `message/send` into a headless run) and registering remote-delegate tools through the tool factory (one `a2a_send_*` tool per remote agent when `exposeAsTools` is set, using `buildSendMessageRequest` / `extractTextFromResult`) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but nothing is served or called. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Whether this node serves this agent, calls remote agents, or both. |
| `serverName` | `string` | `""` | `name` on the published agent card. Empty falls back to the agent's own name. |
| `serverDescription` | `string` | `""` | `description` advertised on the card. |
| `discoveryPath` | `string` | `"/.well-known/agent.json"` | Path the agent card is served from (the A2A well-known default). |
| `version` | `string` | `"0.1.0"` | `version` string on the agent card. |
| `streaming` | `boolean` | `true` | Advertise incremental streaming (`capabilities.streaming`). |
| `pushNotifications` | `boolean` | `false` | Advertise push notifications (`capabilities.pushNotifications`). |
| `serverAuthScheme` | `'none' \| 'bearer' \| 'apiKey' \| 'oauth2'` | `'none'` | Auth remote callers must satisfy to reach this server; advertised in the card's `securitySchemes`. |
| `defaultInputModes` | `string[]` | `['text/plain']` | MIME types the agent accepts as input. |
| `defaultOutputModes` | `string[]` | `['text/plain']` | MIME types the agent can produce as output. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents registered as delegates (`id`, `name`, `cardUrl`, `authScheme`, `authValue`). |
| `exposeAsTools` | `boolean` | `true` | Register each remote agent as an `a2a_send_*` delegate tool. |
| `maxConcurrentTasks` | `number` | `4` | Max remote tasks in flight at once across all delegates. |
| `taskTimeoutMs` | `number` | `60000` | Per-task wall-clock ceiling before a remote delegate call is abandoned. |

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves each connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === undefined` and neither serve a card nor register delegates.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate the runtime calls (it reuses `extractJson` from the structured-output engine for tolerant card parsing):

- **`buildAgentCard(config, meta)`** — assemble the agent card this agent serves. Node config wins where set; otherwise falls back to the resolved agent metadata (name, skills). Advertises a `securityScheme` only when `serverAuthScheme` is not `none`.
- **`validateAgentCard(input)`** — validate a card fetched from a remote agent (raw object, JSON string, or JSON embedded in prose). Requires `name`, `url`, and `capabilities`; missing `skills`/`version` default rather than fail so lean cards still resolve.
- **`wellKnownCardUrl(base, path?)`** — derive the discovery URL from a base origin, returning a concrete `.json` card URL untouched and collapsing duplicate slashes.
- **`authHeader(scheme, value)`** — build the HTTP auth headers for a scheme + credential (`X-API-Key` for `apiKey`, `Authorization: Bearer …` for `bearer`/`oauth2`).
- **`buildSendMessageRequest(text, ids)`** — construct a JSON-RPC `message/send` request delegating `text` to a remote agent (the runtime supplies request/message ids so the engine stays pure).
- **`extractTextFromResult(result)`** — pull the reply text out of an A2A result (bare Message, Task status message, or Task artifacts), surfacing a JSON-RPC error message when present.
- **`remoteToolName(remote)`** — the `a2a_send_<slug>` delegate tool name a remote agent is exposed as.

## Connections

Peripheral → Agent. Multiple A2A nodes may bind to a single Agent; each resolves to its own entry in `AgentConfig.a2a`.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "role": "both",
  "serverName": "Billing Assistant",
  "serverDescription": "Answers billing and invoicing questions.",
  "discoveryPath": "/.well-known/agent.json",
  "version": "1.2.0",
  "streaming": true,
  "pushNotifications": false,
  "serverAuthScheme": "bearer",
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "remoteAgents": [
    {
      "id": "abc123",
      "name": "Weather Service",
      "cardUrl": "https://weather.example.com",
      "authScheme": "apiKey",
      "authValue": "WEATHER_API_KEY"
    }
  ],
  "exposeAsTools": true,
  "maxConcurrentTasks": 4,
  "taskTimeoutMs": 60000
}
```
