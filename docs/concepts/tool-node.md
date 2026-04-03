# Tool Node

> Configures which tools an agent can use — through profiles, groups, individual tools, skills, and plugins.

<!-- source: src/types/nodes.ts#ToolsNodeData -->
<!-- last-verified: 2026-04-03 -->

## Overview

The Tool Node defines the capabilities available to an agent at runtime. Rather than listing individual tools, it uses a layered resolution system: a **profile** provides a baseline set of tool groups, **groups** add categorical tool bundles, **individual tools** allow fine-grained additions, and **plugins** can contribute both tools and skills.

The node also supports **skill definitions** — markdown instructions injected into the system prompt to shape agent behavior — and **sub-agent spawning** for agents that can create child agents.

At runtime, the tool configuration is resolved through `resolveToolNames()` in `src/runtime/tool-factory.ts`, which flattens profiles, groups, individual tools, and plugin tools into a deduplicated list. This list is then used to instantiate concrete `AgentTool` instances.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Tools"` | Display label on the canvas |
| `profile` | `ToolProfile` | `"full"` | Preset tool collection: `full`, `coding`, `messaging`, `minimal`, `custom` |
| `enabledTools` | `string[]` | `[]` | Individual tool names to enable beyond the profile |
| `enabledGroups` | `ToolGroup[]` | `[]` | Additional tool groups to enable beyond the profile |
| `skills` | `SkillDefinition[]` | `[]` | Skill definitions (markdown instructions for the agent) |
| `plugins` | `PluginDefinition[]` | `[]` | Plugin bundles that provide tools and skills |
| `subAgentSpawning` | `boolean` | `false` | Whether the agent can spawn sub-agents |
| `maxSubAgents` | `number` | `3` | Maximum concurrent sub-agents |

**Tool Profiles** (defined in `src/runtime/tool-factory.ts`):

| Profile | Groups included |
|---------|----------------|
| `full` | runtime, fs, web, memory, coding, communication |
| `coding` | runtime, fs, coding, memory |
| `messaging` | web, communication, memory |
| `minimal` | web |
| `custom` | (none — user selects groups/tools manually) |

**Tool Groups**:

| Group | Tools |
|-------|-------|
| `runtime` | bash, code_interpreter |
| `fs` | read_file, write_file, list_directory |
| `web` | web_search, web_fetch |
| `memory` | memory_search, memory_get, memory_save |
| `coding` | bash, read_file, write_file, code_interpreter |
| `communication` | send_message |

**All available tools**: bash, code_interpreter, read_file, write_file, list_directory, web_search, web_fetch, calculator, memory_search, memory_get, memory_save, send_message, image_generation, text_to_speech

## Runtime Behavior

Tool resolution follows this chain in `resolveToolNames()`:

1. **Profile expansion**: If profile is not `custom`, expand it into its constituent groups, then each group into tool names
2. **Group expansion**: Any additional `enabledGroups` are expanded into tool names
3. **Individual tools**: `enabledTools` (resolved as `resolvedTools` in config) are added directly
4. **Plugin tools**: Each enabled plugin's `tools` array is added
5. **Deduplication**: All names are collected into a `Set` for uniqueness

The resulting tool names are passed to `createAgentTools()` which maps each name to a concrete `AgentTool` instance. Memory tools (`memory_search`, `memory_get`, `memory_save`) are skipped here since they're provided separately by the `MemoryEngine`.

Currently implemented tools: `calculator` (evaluates math expressions) and `web_fetch` (HTTP fetch). All others are browser-safe stubs that return "not yet implemented" messages.

**Skill definitions** from the Tools Node are merged with skills from any connected Skills Nodes during config resolution (`src/utils/graph-to-agent.ts`). Skills with `injectAs: 'system-prompt'` are appended to the agent's system prompt.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- At most one Tools Node should be connected to an agent. If multiple are connected, only the first is used.

## Example

```json
{
  "type": "tools",
  "label": "Coding Tools",
  "profile": "coding",
  "enabledTools": ["calculator"],
  "enabledGroups": ["web"],
  "skills": [
    {
      "id": "code-review",
      "name": "Code Review",
      "content": "When reviewing code, check for security vulnerabilities, performance issues, and readability.",
      "injectAs": "system-prompt"
    }
  ],
  "plugins": [],
  "subAgentSpawning": false,
  "maxSubAgents": 3
}
```
