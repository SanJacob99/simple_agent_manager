# A2A Interop Node

> Exposes the agent over the emerging Agent-to-Agent (A2A) protocol — agent cards, JSON-RPC task/message envelopes, and streaming updates — so it can publish itself to and call agents built on *other* frameworks. Complements the in-process `agentComm` bus and in-tree `subAgent` with cross-framework interop.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-27 -->

## Overview

The A2A node is the cross-framework interop surface for an agent. Where `agentComm` is an in-process bus and `subAgent` is in-tree, neither lets this agent talk to agents built on *other* stacks. The Agent-to-Agent (A2A) protocol — an **agent card** (a JSON capability document served at a well-known path), a **JSON-RPC 2.0** transport (`message/send`, `message/stream`), and a **Task** lifecycle (`submitted → working → … → completed | failed | canceled`) — is becoming the lingua franca for that, the way MCP standardized tool access.

Depending on `role`, the node makes the agent an A2A **server** (it publishes an agent card and answers remote tasks), an A2A **client** (it registers remote A2A agents as callable delegate tools), or both. It complements the [Guardrails](guardrails-node.md) (content safety) and [Budget](budget-node.md) (cost safety) nodes on the trust axis: A2A is the interop axis.

At most one A2A node binds to an agent — it owns the single interop surface — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like [Structured Output](structured-output-node.md) and [Reflection](reflection-node.md)).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the server router into `server/index.ts` (serve the card + JSON-RPC endpoint at `exposePath`), the delegate tools into `server/tools/tool-factory.ts`, and the `a2a:task` events into `server/agents/run-coordinator.ts` is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no card is published and no delegate tools register. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Expose this agent (server), consume remote agents (client), or both. |
| `agentCardName` | `string` | `""` | Name published in the agent card. Empty falls back to the agent's own name. |
| `agentCardDescription` | `string` | `""` | Description published in the agent card. Empty falls back to the agent's description. |
| `exposePath` | `string` | `"/a2a"` | Base path the A2A server mounts at. The card is served at `<path>/.well-known/agent-card.json`. |
| `publishedSkills` | `A2ASkill[]` | `[]` | Skills advertised in the published card (`id`, `name`, `description`, `tags`). |
| `advertiseStreaming` | `boolean` | `true` | Advertise SSE `message/stream` capability in the card. |
| `advertisePushNotifications` | `boolean` | `false` | Advertise push-notification capability in the card. |
| `serverAuth` | `'none' \| 'bearer' \| 'apiKey' \| 'oauth2'` | `'none'` | Auth scheme the published server requires from callers. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents registered as callable delegates (`id`, `name`, `cardUrl`, `authScheme`, `authEnvVar`, `toolName`). |
| `exposeDelegateTools` | `boolean` | `true` | Expose one `a2a_call_<agent>` delegate tool per remote agent. |
| `defaultInputModes` | `string[]` | `['text/plain']` | MIME input modes advertised / accepted. |
| `defaultOutputModes` | `string[]` | `['text/plain']` | MIME output modes advertised / produced. |
| `taskTimeoutMs` | `number` | `60000` | How long a client-side remote task may run before it is abandoned. |

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and neither publish a card nor register delegates.

`server/a2a/a2a-engine.ts` provides the interop substrate (dependency-free; the server owns the HTTP router and outbound fetches):

- **`buildAgentCard(config, identity)`** — construct this agent's published Agent Card, falling back to the owning agent's `identity` (name, description, version, url) for any blank card field.
- **`buildSecuritySchemes(scheme)`** — the OpenAPI-style `securitySchemes` + `security` blocks for the card's declared auth (`none` yields an open server).
- **`validateAgentCard(card)`** — validate a *remote* card before trusting it as a delegate (non-empty `name`, http(s) `url`, `version`, `capabilities`, well-formed `skills`). Forward-compatible with unknown extra fields.
- **`resolveDelegateTools(config)`** — derive one delegate tool descriptor per registered remote agent (name, description, `remoteId`, input schema). Empty when the client role is off, `exposeDelegateTools` is false, or a remote lacks a `cardUrl`.
- **`buildMessageSendRequest(opts)`** — frame a JSON-RPC 2.0 `message/send` request, optionally continuing an existing `taskId` / `contextId` and setting `blocking`.
- **`buildAuthHeaders(scheme, credential)`** — the outbound auth header for a scheme (bearer / oauth2 → `Authorization: Bearer …`, apiKey → `X-API-Key`).
- **`parseTaskResult(response)`** — normalize a JSON-RPC response into `{ ok, state, text, taskId, contextId, error }`, handling a JSON-RPC error, a Task (with `status.state` and artifacts), and a bare Message.
- **`isTerminalTaskState(state)` / `normalizeTaskState(raw)`** — the client-side poll loop's stop condition and a defensive state coercion.
- **`normalizeExposePath(path)`** — normalize the mount path (single leading slash, no trailing slash, blank → `/a2a`).

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "role": "both",
  "agentCardName": "Research Concierge",
  "agentCardDescription": "Answers research questions and delegates deep dives.",
  "exposePath": "/a2a",
  "publishedSkills": [
    { "id": "research", "name": "Research", "description": "Answer a research question with citations", "tags": ["nlp", "web"] }
  ],
  "advertiseStreaming": true,
  "advertisePushNotifications": false,
  "serverAuth": "bearer",
  "remoteAgents": [
    {
      "id": "r1",
      "name": "Deep Research Agent",
      "cardUrl": "https://research.example/.well-known/agent-card.json",
      "authScheme": "bearer",
      "authEnvVar": "RESEARCH_A2A_TOKEN",
      "toolName": "ask_deep_researcher"
    }
  ],
  "exposeDelegateTools": true,
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "taskTimeoutMs": 120000
}
```
