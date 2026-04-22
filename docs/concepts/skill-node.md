# Skill Node

> A standalone node for defining named skills that are injected into an agent's system prompt.

<!-- source: src/types/nodes.ts#SkillsNodeData -->
<!-- last-verified: 2026-04-21 -->

## Overview

The Skill Node provides a way to attach named skill capabilities to an agent without configuring a full Tools Node. Each enabled skill is converted into a `SkillDefinition` during config resolution and injected into the agent's system prompt as a `system-prompt` addition.

This is distinct from the `skills` array inside the Tools Node. The Tools Node holds full `SkillDefinition` objects with custom markdown content, while the Skill Node holds a simple list of skill names. During config resolution, each skill name is wrapped into a `SkillDefinition` with auto-generated content (`"You have the skill: {name}"`).

Multiple Skill Nodes can be connected to a single agent — all enabled skills are merged together and combined with any skills from the Tools Node.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Skills"` | Display label on the canvas |
| `enabledSkills` | `string[]` | `["code_generation", "summarization"]` | List of skill names to enable |

## Runtime Behavior

The Skill Node has no dedicated runtime class. Instead, its configuration is processed during `resolveAgentConfig()` in `src/utils/graph-to-agent.ts`:

1. Each skill name in `enabledSkills` is converted to a `SkillDefinition` with empty content:
   ```typescript
   { id: skillName, name: skillName, content: '', injectAs: 'system-prompt' }
   ```
2. These definitions are merged with any skills from the connected Tools Node
3. Skills with empty content render as a bullet list of names in the `## Skills` system prompt section; skills with authored content (typically from the Tools Node's `toolSettings.*.skill` fields) render as full markdown guidance blocks below the bullet list

The resulting system prompt tells the LLM it has certain capabilities, guiding its behavior and response style. Skill Node entries are intentionally declarative tags — to give the agent detailed usage guidance for a capability, configure it as a `SkillDefinition` on the Tools Node or use one of the per-tool `skill` fields in `toolSettings`.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- Multiple Skill Nodes can connect to the same agent — their skills are all merged.

## Example

```json
{
  "type": "skills",
  "label": "Creative Skills",
  "enabledSkills": ["code_generation", "summarization", "translation", "data_analysis"]
}
```
