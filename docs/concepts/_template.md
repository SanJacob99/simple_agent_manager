# {Node Name}

> One-sentence purpose statement.

<!-- source: src/types/nodes.ts#{InterfaceName} -->
<!-- last-verified: YYYY-MM-DD -->

## Overview

2-3 paragraphs explaining what this node does, when you would use it, and how it relates to other nodes in the graph. Written for a developer who has not seen the codebase before.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `exampleProp` | `string` | `""` | Description of the property |

Properties are derived from the TypeScript interface in `src/types/nodes.ts` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

How the node's configuration is resolved into an `AgentConfig` field and what happens at runtime. Reference the specific runtime class or function. If no runtime implementation exists yet, state "Not yet implemented at runtime."

## Connections

Which other node types this node connects to or from, and what the edge represents.

## Example

A short JSON snippet or description showing a practical configuration.

```json
{
  "exampleProp": "value"
}
```
