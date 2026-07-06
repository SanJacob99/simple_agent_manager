# A2A Interop Node

> Gives an agent two Agent-to-Agent (A2A) surfaces: a **server** surface that publishes an agent card and accepts inbound task/message envelopes, and a **client** surface that registers remote A2A agents as callable delegates — letting this agent interoperate with agents built on any A2A-speaking framework.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-06 -->

## Overview

`agentComm` is an in-process bus and `subAgent` is in-tree; neither lets this agent talk to agents built on *other* frameworks. The emerging [Agent-to-Agent (A2A) protocol](https://a2a-protocol.org) — agent cards, task/message envelopes, streaming updates — is becoming the lingua franca for cross-framework agent interop, much as MCP standardized tools. The A2A node brings that interop into the builder.

It carries two surfaces:

- **Server** — expose this agent over A2A by publishing an *agent card* (a JSON document at `/.well-known/agent-card.json` describing the agent's identity, capabilities, advertised skills, and inbound auth) and accepting `message/send` / `message/stream` requests.
- **Client** — call *other* A2A agents: each remote agent carries a card URL, an auth scheme, and a timeout, and (when `exposeAsTool` is set) is registered as a callable delegate tool (`a2a__<id>`) the model can invoke.

At most one A2A node binds to an agent, so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like Structured Output and Reflection). It complements `agentComm` (in-process fan-out) and `subAgent` (in-tree delegation) with cross-framework reach.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the HTTP surface into the server (mount the card route + `message/send` handler when `exposeAsServer`, register `a2a__<id>` delegate tools for `remoteAgents` in the tool factory, emit `a2a:remote_error`) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end. See `docs/roadmap/2026-modernization.md`.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the agent is neither served over A2A nor able to call remote agents. |
| `exposeAsServer` | `boolean` | `false` | Publish an agent card and accept inbound A2A task/message requests. |
| `agentName` | `string` | `""` | Name advertised on the card. Empty falls back to the agent's own name. |
| `agentDescription` | `string` | `""` | Description advertised on the card. |
| `serverPath` | `string` | `"/a2a"` | Path prefix the A2A server mounts under. |
| `skills` | `A2ASkillDescriptor[]` | `[]` | Skills advertised on the card (`id`, `name`, `description`, `tags`, `examples`) so remote callers can discover capabilities. |
| `streaming` | `boolean` | `true` | Advertise SSE (`message/stream`) task updates on the card. |
| `pushNotifications` | `boolean` | `false` | Advertise push-notification (webhook) task updates on the card. |
| `authScheme` | `'none' \| 'apiKey' \| 'bearer'` | `'none'` | Inbound auth advertised in the card's `securitySchemes`. |
| `authHeaderName` | `string` | `"X-API-Key"` | Header carrying the key when `authScheme` is `apiKey`. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents this agent can delegate to (`id`, `name`, `cardUrl`, `enabled`, `exposeAsTool`, `timeoutMs`, `authScheme`). |
| `defaultTimeoutMs` | `number` | `30000` | Default per-request timeout for remote agents that don't set one. |
| `onRemoteError` | `'fail' \| 'warn' \| 'ignore'` | `'warn'` | Behaviour when a remote agent call fails. |

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and neither surface is active.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate the server calls:

- **`buildAgentCard(config, baseUrl, fallbackName, version?)`** — builds a spec-shaped `AgentCard` (protocol version, capabilities, `defaultInputModes`/`defaultOutputModes`, skills, and `securitySchemes`) from the resolved config.
- **`buildSecuritySchemes(config)`** — maps the inbound `authScheme` into the card's `securitySchemes` + `security` pair (`apiKey` header scheme or `http` bearer scheme; `none` yields an open endpoint).
- **`buildSendMessageRequest(text, requestId, messageId, opts?)`** — constructs a JSON-RPC 2.0 `message/send` (or `message/stream`) envelope carrying a text part, optionally threading `taskId`/`contextId`/`blocking`.
- **`parseTaskResult(response)`** — parses a remote JSON-RPC response into `{ text, state, taskId }`, recovering text from a Task's artifacts, then its final agent history message, then a bare Message; throws on a JSON-RPC `error` member so the caller's error policy applies.
- **`extractTextFromParts(parts)`** — concatenates the text from A2A `parts`, ignoring non-text parts.
- **`remoteAgentsAsTools(config)` / `remoteAgentToolName(agent)`** — selects the enabled, `exposeAsTool` remote agents and derives their `a2a__<id>` tool names.
- **`resolveRemoteTimeout(config, agent)`** — the agent's own timeout, else the config default, else a 30s floor.
- **`applyRemoteErrorPolicy(config, agent, error)`** — encodes `fail` / `warn` / `ignore`: whether to rethrow, whether to emit an `a2a:remote_error` event, and the tool result text to hand back to the model.
- **`validateRemoteAgent(agent)`** — returns human-readable problems (missing id, non-http URL, negative timeout) for the property/settings surfaces.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "A2A Interop",
  "enabled": true,
  "exposeAsServer": true,
  "agentName": "Support Orchestrator",
  "agentDescription": "Routes customer questions to billing and shipping specialists.",
  "serverPath": "/a2a",
  "skills": [
    { "id": "triage", "name": "Triage", "description": "Classify and route a customer request", "tags": ["support", "routing"], "examples": ["my order is late"] }
  ],
  "streaming": true,
  "pushNotifications": false,
  "authScheme": "apiKey",
  "authHeaderName": "X-API-Key",
  "remoteAgents": [
    {
      "id": "billing",
      "name": "Billing Agent",
      "cardUrl": "https://billing.example.com/.well-known/agent-card.json",
      "enabled": true,
      "exposeAsTool": true,
      "timeoutMs": 20000,
      "authScheme": "bearer"
    }
  ],
  "defaultTimeoutMs": 30000,
  "onRemoteError": "warn"
}
```
