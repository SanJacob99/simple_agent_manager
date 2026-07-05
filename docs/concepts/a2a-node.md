# A2A Interop Node

> Exposes this agent over the Agent-to-Agent (A2A) protocol and/or registers remote A2A agents as callable delegates. A2A is the emerging cross-framework interop standard — agent cards, task/message envelopes, streaming updates — becoming to agents what MCP is to tools.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-05 -->

## Overview

`agentComm` is an in-process bus and `subAgent` is in-tree — neither lets this agent talk to agents built on *other* frameworks. The A2A node bridges that gap. It has two sides, selected by `role`:

- **Server** — publishes an *agent card* at `/.well-known/agent-card.json` (name, description, version, capabilities, advertised skills, security scheme) and accepts inbound tasks, running them through the same headless-run path the cron scheduler uses.
- **Client** — registers *remote agents* as callable delegates. Each remote becomes a delegate tool (`a2a_<name>`); invoking it sends a JSON-RPC `message/send` envelope to the remote and returns the extracted task result.

At most one A2A node binds to an agent — it owns the single published card and delegate registry — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like Structured Output / Reflection).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the client/server sides into `server/agents/run-coordinator.ts` and mounting the A2A server route (register delegate tools, serve the card, poll delegated tasks, emit `a2a:delegated` / `a2a:task_failed` events) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A Interop"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but neither side is active. |
| `role` | `'server' \| 'client' \| 'both'` | `'both'` | Which side(s) of the protocol are active. |
| `agentName` | `string` | `""` | The agent card's `name`. Empty falls back to the connected agent's name. |
| `agentDescription` | `string` | `""` | The card's `description` — how other agents decide whether to delegate. |
| `agentVersion` | `string` | `"1.0.0"` | Semver advertised in the card. |
| `publicUrl` | `string` | `""` | Public base URL other agents reach this one at. Empty = derived from the server host. |
| `streaming` | `boolean` | `true` | Advertise incremental streaming updates (`capabilities.streaming`). |
| `advertisedSkills` | `string[]` | `[]` | Skill ids/names surfaced in the card's `skills[]`. |
| `inboundAuthScheme` | `'none' \| 'bearer' \| 'apiKey' \| 'oauth2'` | `'bearer'` | Auth scheme required of inbound callers. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote agents this agent can delegate tasks to (see below). |
| `exposeAsTools` | `boolean` | `true` | Register each remote agent as a callable delegate tool. |
| `taskTimeoutMs` | `number` | `60000` | Per-delegated-task timeout in milliseconds. |
| `maxDelegationsPerRun` | `number` | `8` | Loop/cost guard: max tasks delegated per run. `0` disables the ceiling. |

Each `remoteAgents` entry: `{ id, name, url, authScheme, authValue }`, where `authValue` is an env-var name (preferred) or literal token/key. Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`). Agents without one have `a2a === null` and neither publish a card nor delegate.

`server/a2a/a2a-engine.ts` provides the dependency-free substrate:

- **`buildAgentCard(config, ctx)`** — assembles the spec-shaped agent card; blank `agentName` / `publicUrl` fall back to the runtime-supplied context. Served at `WELL_KNOWN_CARD_PATH`.
- **`buildSecuritySchemes(scheme)`** — maps `inboundAuthScheme` into the card's `securitySchemes`.
- **`delegateToolName(remote)`** / **`slugify(name)`** — deterministic `a2a_<slug>` delegate tool names.
- **`validateRemoteAgent(remote)`** — rejects a missing/non-http URL or a credential-less authenticated scheme; shared by UI and runtime.
- **`buildAuthHeaders(scheme, value)`** — outbound headers (`Authorization: Bearer …` / `x-api-key`); the runtime resolves env-var names to secrets first.
- **`buildMessageSendEnvelope(text, ids)`** — the JSON-RPC 2.0 `message/send` request; ids are supplied by the caller (the engine reads neither clock nor RNG).
- **`extractTextFromResult(result)`** — pulls text out of a returned Task (`status.message`, `artifacts[].parts[]`) or bare Message (`parts[]`); tolerates legacy `type:'text'` parts.
- **`isTerminalTaskState` / `isSuccessTaskState`** — drive the delegate poll loop over the A2A task state machine.
- **`shouldDelegate(config, delegationsSoFar)`** — the per-run delegation guard (`0` = unlimited).
- **`servesAgentCard(config)`** — whether the role publishes a card.

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "role": "both",
  "agentName": "Research Agent",
  "agentDescription": "Runs multi-source web research and returns a cited summary.",
  "agentVersion": "2.1.0",
  "publicUrl": "https://research.example.com",
  "streaming": true,
  "advertisedSkills": ["deep-research", "summarize"],
  "inboundAuthScheme": "bearer",
  "remoteAgents": [
    {
      "id": "wx1",
      "name": "Weather Bot",
      "url": "https://weather.example.com",
      "authScheme": "bearer",
      "authValue": "WEATHER_TOKEN"
    }
  ],
  "exposeAsTools": true,
  "taskTimeoutMs": 60000,
  "maxDelegationsPerRun": 8
}
```
