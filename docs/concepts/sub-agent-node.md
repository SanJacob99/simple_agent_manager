# Sub-Agent Node

> A peripheral that declares a named, one-shot sub-agent the parent agent can dispatch via `sessions_spawn`.

<!-- source: src/types/nodes.ts#SubAgentNodeData -->
<!-- last-verified: 2026-05-01 -->

## Overview

The Sub-Agent Node attaches to an Agent Node as a peripheral. Each declared sub-agent has its own system prompt, model, and dedicated Tools Node. The parent agent invokes a sub-agent by name through the `sessions_spawn` tool, which dispatches a one-shot run that reports back. Once the sub-agent returns, errors, or is killed, the sub-session is sealed; follow-up messages require spawning a fresh sub-agent. Retry logic lives entirely in the parent agent — when an output is unsatisfactory, the parent reasons over the previous spawn's tool result and spawns again with adjusted overrides.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `""` | Identity used by the parent (e.g. `researcher`). Must match `/^[a-z][a-z0-9_-]{0,31}$/` |
| `description` | `string` | `""` | Shown to the parent in the `sessions_spawn` schema |
| `systemPrompt` | `string` | `"You are a focused assistant. ..."` | The sub's system prompt |
| `modelIdMode` | `'inherit' \| 'custom'` | `'inherit'` | When `inherit`, the parent's `modelId` is used at runtime |
| `modelId` | `string` | `""` | Honored only when `modelIdMode === 'custom'` |
| `thinkingLevelMode` | `'inherit' \| 'custom'` | `'inherit'` | Same convention as modelId |
| `thinkingLevel` | `ThinkingLevel` | `'off'` | Honored only when `thinkingLevelMode === 'custom'` |
| `modelCapabilities` | `ModelCapabilityOverrides` | `{}` | Snapshot/overrides like the Agent Node |
| `overridableFields` | `SubAgentOverridableField[]` | `[]` | Fields the parent may override per-call (`modelId`, `thinkingLevel`, `systemPromptAppend`, `enabledTools`) |
| `workingDirectoryMode` | `'derived' \| 'custom'` | `'derived'` | When `derived`, cwd is `<parentCwd>/subagent/<name>` |
| `workingDirectory` | `string` | `""` | Honored only when `workingDirectoryMode === 'custom'` |
| `recursiveSubAgentsEnabled` | `boolean` | `false` | When true, the sub may call `sessions_spawn` itself. Marked **Unstable** in the UI |

## Connections

- Receives from: Provider (optional), Tools (REQUIRED), Skills (any), MCP (any)
- Sends to: Agent Node only (peripheral→agent edge)
- Multiple Sub-Agent Nodes may attach to one agent; names must be unique per agent

## Runtime Behavior

1. `resolveAgentConfig()` walks edges into each Sub-Agent Node, requires exactly one Tools Node, optionally accepts one Provider Node, and merges Skills/MCPs with the parent (dedicated wins by id).
2. The parent's `sessions_spawn` tool is auto-enabled when `agentConfig.subAgents.length > 0`. Its schema lists declared sub-agent names as a literal-union enum.
3. When the parent calls `sessions_spawn({ subAgent: "<name>", message, overrides })`, the runtime validates `overrides` against `subAgent.overridableFields`, builds a synthetic `AgentConfig`, and dispatches via `SubAgentExecutor` — bypassing the parent's run-concurrency slot so the sub runs alongside the parent's tool call.
4. Each sub-session uses a key of shape `sub:<parentSessionKey>:<subAgentName>:<shortUuid>` and gets a durable `SessionStoreEntry` under the parent's `StorageEngine` before child dispatch starts.
5. `RunCoordinator` builds a fresh child `AgentRuntime` through its injected runtime factory, persists the child's user/assistant/tool transcript events, and destroys the child runtime on completion, error, or abort.
6. The child runtime receives `subAgents: []` and has `sessions_spawn`, `sessions_yield`, and `subagents` stripped from its resolved tool list in v1, so recursive fan-out is disabled even if the node's recursive flag is set.
7. The registry and durable sub-session metadata mark the sub-session `sealed` when the child run completes, errors, or is killed. `sessions_send` to any sub-session returns a one-shot error and no further work is dispatched.
8. Kill (REST `/api/subagents/:id/kill` or agent-facing `subagents({action: 'kill'})`) marks the registry record as `killed` *before* aborting the run, so the abort path doesn't downgrade the terminal state to `error`.

## Inheritance

| Resource | Source |
|---|---|
| Provider | Dedicated wins; else parent's |
| Tools | Dedicated only (required) |
| Storage | Inherited (sub-sessions live under parent's storage) |
| Memory | None in v1 (`memory: null` on the synthetic config); sub-session message history starts empty per spawn |
| Context Engine | None — sub-agents are one-shot |
| Skills | Parent ∪ dedicated; dedicated wins on `id` collision |
| MCP | Parent ∪ dedicated; dedicated wins on `mcpNodeId` collision |
| Connectors / Vector DB / AgentComm / Cron | Never apply |

## Example

```json
{
  "type": "subAgent",
  "name": "researcher",
  "description": "Researches a topic and reports back with sources.",
  "systemPrompt": "You are a research assistant. Search the web; return concise findings with sources.",
  "modelIdMode": "custom",
  "modelId": "anthropic/claude-opus-4-7",
  "thinkingLevelMode": "inherit",
  "thinkingLevel": "off",
  "modelCapabilities": {},
  "overridableFields": ["thinkingLevel", "systemPromptAppend"],
  "workingDirectoryMode": "derived",
  "workingDirectory": "",
  "recursiveSubAgentsEnabled": false
}
```
