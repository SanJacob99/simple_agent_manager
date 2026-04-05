# Agent Node

> The central hub node that represents an AI agent — defines which LLM to use, the system prompt, and orchestrates all connected peripheral nodes.

<!-- source: src/types/nodes.ts#AgentNodeData -->
<!-- last-verified: 2026-04-04 -->

## Overview

The Agent Node is the core building block of every graph. Each agent node represents a single AI agent backed by an LLM provider and model. It is the only node type that can receive connections from peripheral nodes (Memory, Tools, Skills, Context Engine, etc.), and it is the only node that can be chatted with.

When a user opens the chat drawer for an agent, the system traverses all edges pointing to that agent node, collects the connected peripheral configurations, and resolves them into an `AgentConfig` via `resolveAgentConfig()` in `src/utils/graph-to-agent.ts`. This config is then used to instantiate an `AgentRuntime` which wraps a `pi-agent-core` Agent with integrated memory, tools, and context management.

The agent node also supports model capability overrides, allowing users to specify custom context window sizes, max output tokens, and vision/thinking support for models not in the built-in catalog — particularly useful with OpenRouter's model discovery.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | `""` | Display name for the agent |
| `nameConfirmed` | `boolean` | `false` | Whether the user has confirmed the agent name |
| `systemPrompt` | `string` | `"You are a helpful assistant."` | The system prompt sent to the LLM |
| `provider` | `string` | `"anthropic"` | LLM provider ID (anthropic, openai, openrouter, google, ollama, mistral, groq, xai) |
| `modelId` | `string` | `"claude-sonnet-4-20250514"` | Model identifier for the selected provider |
| `thinkingLevel` | `ThinkingLevel` | `"off"` | Thinking/reasoning level: off, minimal, low, medium, high, xhigh |
| `description` | `string` | `""` | Optional description of the agent's purpose |
| `tags` | `string[]` | `[]` | Freeform tags for categorization |
| `modelCapabilities` | `ModelCapabilityOverrides` | `{}` | Optional overrides for context window, max output, vision, thinking support |
| `systemPromptMode` | `SystemPromptMode` | `"auto"` | How the system prompt is built: `auto` (app-managed, read-only), `append` (app-built + user instructions at the end), `manual` (user-owned, no app injection) |

## Runtime Behavior

When the chat drawer opens for an agent, the following happens:

1. **Config resolution** (`src/utils/graph-to-agent.ts`): `resolveAgentConfig()` finds all peripheral nodes connected to this agent via edges, extracts their configuration, and builds a flat `AgentConfig` JSON object.

2. **System prompt augmentation**: `resolveAgentConfig` calls `buildSystemPrompt()` to assemble a structured prompt with named sections (safety, tooling, skills, workspace, time, runtime). Behavior depends on `systemPromptMode`: in `auto` mode the prompt is fully app-managed and the user's system prompt field is read-only; in `append` mode the app-built prompt is used and the user's instructions are appended at the end; in `manual` mode only the user's text is used with no app injection.

3. **Runtime creation** (`src/runtime/agent-runtime.ts`): `AgentRuntime` takes the config + an API key resolver and creates:
   - A `MemoryEngine` (if memory node connected)
   - A `ContextEngine` (if context engine node connected)
   - Tool instances via `resolveToolNames()` + `createAgentTools()`
   - A `pi-agent-core` Agent with the assembled system prompt, model, tools, and `transformContext`

4. **Model resolution** (`src/runtime/model-resolver.ts`): The provider + modelId are resolved to a concrete model object. Capability overrides (from the agent node) are applied on top of built-in or discovered model metadata.

5. **Event streaming**: The runtime forwards `pi-agent-core` agent events to listeners. The ChatDrawer subscribes to these for streaming text, tool calls, and status updates.

## Connections

- **Receives from**: Memory, Tools, Skills, Context Engine, Agent Comm, Connectors, Database, Vector Database (all peripheral types)
- **Sends to**: None — agent nodes are always the target of edges, never the source
- Only peripheral → agent connections are allowed. Agent-to-agent and peripheral-to-peripheral connections are rejected by the canvas validation logic.

## Example

```json
{
  "type": "agent",
  "name": "Research Assistant",
  "nameConfirmed": true,
  "systemPrompt": "You are a research assistant. Search the web for information, save important findings to memory, and provide well-sourced answers.",
  "provider": "anthropic",
  "modelId": "claude-sonnet-4-20250514",
  "thinkingLevel": "medium",
  "description": "Web research agent with memory",
  "tags": ["research", "web"],
  "modelCapabilities": {},
  "systemPromptMode": "append"
}
```
