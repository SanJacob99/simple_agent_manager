# Agent Node

> The central hub node that stores model and prompt settings while connected peripheral nodes supply runtime services.

<!-- source: src/types/nodes.ts#AgentNodeData -->
<!-- last-verified: 2026-04-13 -->

## Overview

The Agent Node is the core node in every graph. It stores the agent's name, prompt settings, selected model id, and a snapshot of model capabilities. Peripheral nodes connect into the agent to provide memory, tools, context handling, storage, and now provider identity.

The agent no longer stores a `provider` field directly. Provider selection lives on a connected Provider Node, and `resolveAgentConfig()` in `src/utils/graph-to-agent.ts` builds a structured `ResolvedProviderConfig` from that connection.

The Agent Node still owns `modelId`, `thinkingLevel`, and `modelCapabilities`. That capability snapshot lets the backend resolve models even when live catalog data is stale or unavailable.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `""` | Display name for the agent |
| `nameConfirmed` | `boolean` | `false` | Whether the user has confirmed the generated or edited name |
| `systemPrompt` | `string` | `"You are a helpful assistant."` | User-owned system prompt or appended instructions |
| `modelId` | `string` | `"anthropic/claude-sonnet-4-20250514"` | Model id for the connected provider |
| `thinkingLevel` | `ThinkingLevel` | `"off"` | Requested reasoning level for supported models |
| `description` | `string` | `""` | Optional purpose/summary for the agent |
| `tags` | `string[]` | `[]` | Freeform tags used by the UI |
| `modelCapabilities` | `ModelCapabilityOverrides` | `{}` | Snapshotted model metadata plus any user overrides |
| `systemPromptMode` | `SystemPromptMode` | `"auto"` | Prompt assembly mode. `auto` is resolved as app-managed append behavior |
| `showReasoning` | `boolean` | `false` | Whether to expose reasoning output in the UI when supported |
| `verbose` | `boolean` | `false` | Whether to prefer more verbose runtime output |

### ModelCapabilityOverrides Fields

| Field | Type | Description |
|-------|------|-------------|
| `reasoningSupported` | `boolean` | Whether the model supports reasoning |
| `inputModalities` | `ModelInputModality[]` | Supported input types such as `text` or `image` |
| `contextWindow` | `number` | Maximum input token window |
| `maxTokens` | `number` | Maximum response tokens |
| `cost` | `ModelCostInfo` | Pricing data for input/output/cache tokens |
| `outputModalities` | `string[]` | Supported output types |
| `tokenizer` | `string` | Tokenizer identifier |
| `supportedParameters` | `string[]` | Model API parameters known to be supported |
| `topProvider` | `ModelTopProviderInfo` | Provider-specific limits and moderation metadata |
| `description` | `string` | Provider/catalog description text |
| `modelName` | `string` | Human-readable model name |

## Runtime Behavior

1. `resolveAgentConfig()` collects incoming peripheral nodes and creates a serializable `AgentConfig`.
2. The connected Provider Node is resolved into `AgentConfig.provider`. If no Provider Node is connected, config resolution still succeeds, but runtime validation reports the graph as unrunnable.
3. `buildSystemPrompt()` assembles the final system prompt based on `systemPromptMode`, tool summaries, skills, workspace path, and runtime metadata. The Runtime section emits `Runtime: host=… | os=… | model=…` with **no** `thinking=<level>` field or prose reasoning line — the thinking level is communicated to the provider via the API `reasoning.effort` parameter, and plain-text thinking directives in the system prompt can cause Gemini 3 to switch to a "think silently" mode (documented by Google's Gemini 3 prompting guide).
4. `server/runtime/agent-runtime.ts` creates the runtime agent, and `server/runtime/model-resolver.ts` resolves the final runtime model using:
   - the provider plugin's runtime provider id
   - the stored `modelId`
   - the agent's snapshotted capability overrides
5. The model picker UI in the Agent properties panel is driven by the connected Provider Node's catalog state, keyed by provider instance rather than a hardcoded provider string.
6. Interactive chat requires a connected Provider Node, Context Engine Node, and Storage Node before the drawer can start a session.

## Connections

- Receives from: Provider, Memory, Tools, Skills, Context Engine, Agent Comm, Connectors, Storage, Vector Database, and Cron nodes
- Sends to: None
- Only peripheral-to-agent connections are supported
- Runtime validation requires exactly one connected Provider Node

## Example

```json
{
  "type": "agent",
  "name": "Research Assistant",
  "nameConfirmed": true,
  "systemPrompt": "You are a research assistant. Search the web for information, save important findings to memory, and provide well-sourced answers.",
  "modelId": "anthropic/claude-sonnet-4-20250514",
  "thinkingLevel": "medium",
  "description": "Web research agent with memory",
  "tags": ["research", "web"],
  "modelCapabilities": {
    "reasoningSupported": true,
    "inputModalities": ["text", "image"],
    "contextWindow": 200000,
    "maxTokens": 8192,
    "cost": { "input": 0.000003, "output": 0.000015, "cacheRead": 0.0000003, "cacheWrite": 0.00000375 },
    "outputModalities": ["text"],
    "tokenizer": "claude",
    "supportedParameters": ["temperature", "top_p", "reasoning"],
    "topProvider": { "contextLength": 200000, "maxCompletionTokens": 8192, "isModerated": true },
    "description": "Claude Sonnet 4 is Anthropic's latest model.",
    "modelName": "Claude Sonnet 4"
  },
  "systemPromptMode": "append",
  "showReasoning": false,
  "verbose": false
}
```
