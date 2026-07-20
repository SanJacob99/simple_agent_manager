# A2A Node

> Wires this agent into the Agent-to-Agent (A2A) protocol — the emerging cross-framework standard for agents to discover and call one another. Exposes the agent as an A2A server (publishes an agent card, accepts remote tasks) and/or registers remote A2A agents as callable delegates.

<!-- source: src/types/nodes.ts#A2ANodeData -->
<!-- last-verified: 2026-07-20 -->

## Overview

Where the [Agent Comm node](agent-comm-node.md) is an in-process bus and the [Sub-Agent node](sub-agent-node.md) is in-tree, neither lets this agent talk to agents built on *other* frameworks. A2A is the emerging protocol that standardizes cross-framework agent interop much as MCP standardized tools: an **agent card** advertises capabilities for discovery, a JSON-RPC 2.0 task/message envelope carries work, and streamed status updates report progress through a small task state machine.

The A2A node has two sides, selected by `mode`:

- **Server** (`server` / `both`) — publish an agent card at `<serverPath>/.well-known/agent-card.json` and accept remote tasks. Callers discover the agent's skills and required auth from the card.
- **Client** (`client` / `both`) — register remote A2A agents as callable delegates. Each remote flagged `exposeAsTool` becomes a tool the agent can call to hand off a task.

At most one A2A node binds to an agent — it is the agent's single interop identity — so it resolves to a single optional value on `AgentConfig.a2a` rather than a list (like [Reflection](reflection-node.md) and [Structured Output](structured-output-node.md)).

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring it into an Express router under `server/a2a/` (mount the agent-card + task endpoints, bridge `runtime.prompt()` to the task state machine, register delegate tools through the tool factory, resolve `authRef` credentials at call time) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"A2A"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but no A2A surface is served and no delegates are exposed. |
| `mode` | `'server' \| 'client' \| 'both'` | `'both'` | Expose this agent (`server`), consume remote agents (`client`), or both. |
| `cardName` | `string` | `"Simple Agent"` | Name published in this agent's agent card. |
| `cardDescription` | `string` | "An agent built with Simple Agent Manager…" | Description published in the agent card. |
| `serverPath` | `string` | `"/a2a"` | Mount path for the A2A server and its agent card. |
| `streaming` | `boolean` | `true` | Advertise SSE streaming (`message/stream`) support. |
| `pushNotifications` | `boolean` | `false` | Advertise push-notification (webhook) support. |
| `stateTransitionHistory` | `boolean` | `true` | Advertise task state-transition history. |
| `defaultInputModes` | `string[]` | `["text/plain"]` | MIME types accepted as task input, advertised in the card. |
| `defaultOutputModes` | `string[]` | `["text/plain"]` | MIME types produced as task output, advertised in the card. |
| `skills` | `A2ASkillCard[]` | `[]` | Skill cards (`id`, `name`, `description`, `tags`) advertised to callers. |
| `authScheme` | `'none' \| 'bearer' \| 'apiKey'` | `'bearer'` | Auth scheme required to call this agent's A2A endpoint. |
| `remoteAgents` | `A2ARemoteAgent[]` | `[]` | Remote A2A agents this agent can delegate tasks to. |
| `taskTimeoutMs` | `number` | `120000` | Per-task wall-clock ceiling in ms. `0` means no limit. |
| `maxConcurrentTasks` | `number` | `4` | Ceiling on concurrent inbound + outbound A2A tasks. |

Each `remoteAgents` entry carries `id`, `name`, `cardUrl` (the remote's `.well-known/agent-card.json`), `transport` (`jsonrpc` / `grpc` / `rest`), `authRef` (a credential *reference*, never the secret), and `exposeAsTool`.

Properties are derived from `src/types/nodes.ts#A2ANodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected A2A node into a `ResolvedA2AConfig` on `AgentConfig.a2a` (`shared/agent-config.ts`), copying skill cards and remote agents into fresh arrays so later graph edits don't mutate the resolved config. Agents without one have `a2a === null` and expose no interop surface.

`server/a2a/a2a-engine.ts` provides the protocol substrate (dependency-free):

- **`buildAgentCard(config, baseUrl)`** — constructs the A2A agent card served for discovery, joining `baseUrl` with `serverPath`, mirroring the node's capabilities, and emitting a security scheme (`bearer` / `apiKey` / none) that matches `authScheme`.
- **`nextTaskState(current, event)` / `isTerminalTaskState(state)`** — the task state machine: `submitted → working → completed`, with an `input-required` detour, `cancel` from any non-terminal state, and `null` for illegal transitions (including any event from a terminal state).
- **`validateMessageSend(raw)`** — validates an inbound `message/send` / `message/stream` param: a well-formed `message` with a valid `role` and a non-empty `parts` array of recognized `text` / `file` / `data` parts. Returns the narrowed message or a list of errors.
- **`textToParts` / `partsToText`** — convert between plain text and A2A message parts.
- **`resolveDelegateTools(config)` / `buildDelegateToolSpec(remote)` / `delegateToolName(remote)`** — turn remote agents flagged `exposeAsTool` into callable delegate tool descriptors, deriving a stable `a2a_<slug>` name and de-duplicating collisions. Empty in `server`-only mode or when disabled.
- **`servesInbound(config)`** — whether the node serves an inbound endpoint (agent card + tasks).

## Connections

Peripheral → Agent. At most one A2A node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "a2a",
  "label": "Interop",
  "enabled": true,
  "mode": "both",
  "cardName": "Research Assistant",
  "cardDescription": "Answers research questions with cited sources.",
  "serverPath": "/a2a",
  "streaming": true,
  "pushNotifications": false,
  "stateTransitionHistory": true,
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [
    { "id": "research", "name": "Research", "description": "Answer a question with cited sources.", "tags": ["research", "web"] }
  ],
  "authScheme": "bearer",
  "remoteAgents": [
    {
      "id": "summarizer",
      "name": "Summarizer",
      "cardUrl": "https://summarizer.example.com/.well-known/agent-card.json",
      "transport": "jsonrpc",
      "authRef": "SUMMARIZER_TOKEN",
      "exposeAsTool": true
    }
  ],
  "taskTimeoutMs": 120000,
  "maxConcurrentTasks": 4
}
```
