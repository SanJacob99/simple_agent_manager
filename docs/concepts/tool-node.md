# Tool Node

> Configures which tools an agent can use through profiles, groups, direct enables, skills, and plugins.

<!-- source: src/types/nodes.ts#ToolsNodeData -->
<!-- last-verified: 2026-04-17 -->

## Overview

The Tool Node defines the capabilities available to an agent at runtime. Rather than storing a flat tool list, it uses layered resolution:

- a profile contributes baseline groups
- groups add bundles of tools
- individual tools opt specific names in
- tool plugins add extra tools and skills

Skills stored on the Tool Node are merged into system prompt content during graph resolution. The resolved tool names are then instantiated by `createAgentTools()` in `server/runtime/tool-factory.ts`.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Tools"` | Display label on the canvas |
| `profile` | `ToolProfile` | `"full"` | Preset tool collection: `full`, `coding`, `messaging`, `minimal`, `custom` |
| `enabledTools` | `string[]` | `[]` | Individual tool names to enable beyond the profile |
| `enabledGroups` | `ToolGroup[]` | `[]` | Additional tool groups to enable beyond the profile |
| `skills` | `SkillDefinition[]` | `[]` | Skill definitions that are folded into prompt assembly |
| `plugins` | `PluginDefinition[]` | `[]` | Plugin bundles that contribute tools, skills, and optional hooks |
| `subAgentSpawning` | `boolean` | `false` | Whether the agent may spawn sub-agents |
| `maxSubAgents` | `number` | `3` | Maximum concurrent sub-agents |

## Runtime Behavior

Tool name resolution happens in `shared/resolve-tool-names.ts` in this order:

1. Expand the selected profile into groups
2. Expand the resulting groups into tool names
3. Add `enabledGroups`
4. Add `enabledTools`
5. Add tools contributed by enabled tool plugins
6. Deduplicate the final list

`server/runtime/tool-factory.ts` then instantiates concrete `AgentTool` objects:

- memory tools are skipped there because `MemoryEngine` provides them separately
- session tools are skipped because they are injected later by the run coordinator
- `calculator` and the built-in `web_fetch` have real implementations
- most other tools are still stubs
- if the resolved tool list already includes `web_search` or `web_fetch` and the active provider plugin supplies replacements, `createAgentTools()` swaps in the provider-backed implementation instead of auto-adding new tools

The `media` group also exposes a `canvas` tool. `canvas` writes a self-contained
HTML/CSS/JS bundle to `<workspace>/canvas/<id>/` and returns a URL of the form
`<canvasPublicBaseUrl>/canvas/<agentId>/<id>/index.html`. The server serves
those files from the agent's workspace so the user can open the result in a
browser. Use it for small interactive visualizations, prototypes, or mini-apps
that are not a static image. The base URL defaults to the local server origin
(`http://localhost:${STORAGE_PORT}`) but can be overridden per-agent via
`AgentConfig.canvasPublicBaseUrl` or the `CANVAS_PUBLIC_BASE_URL` env var.

Tool skills from the Tool Node and connected Skills Nodes are merged during `resolveAgentConfig()` and then folded into the system prompt by `buildSystemPrompt()`.

## Connections

- Sends to: Agent Node
- Receives from: None
- At most one Tool Node should be connected to an agent. If multiple are connected, only the first is used.

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
