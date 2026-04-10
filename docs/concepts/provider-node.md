<!-- source: src/types/nodes.ts#ProviderNodeData -->
<!-- last-verified: 2026-04-10 -->

# Provider Node

> Defines which provider plugin an agent uses and how the server should resolve its auth reference and base URL.

## Overview

The Provider Node is a peripheral node that connects to an Agent Node and owns provider identity. It replaces the old `agent.data.provider` field with a dedicated node that stores only provider metadata:

- which plugin to use
- which auth method is selected
- which environment variable name should be used as a fallback
- an optional base URL override

The node never stores the raw API key. The frontend resolves a connected Provider Node into `ResolvedProviderConfig`, and the server fills in the actual secret and final base URL at runtime.

The available provider choices come from the backend provider registry (`GET /api/providers`). When new Provider nodes are created from the canvas, the graph store overlays the schema defaults with `providerDefaults` from settings.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Provider"` | Canvas label for the node |
| `pluginId` | `string` | `"openrouter"` | Provider plugin id to use for runtime/model discovery |
| `authMethodId` | `string` | `"api-key"` | Selected auth method within the plugin |
| `envVar` | `string` | `"OPENROUTER_API_KEY"` | Environment variable name used as API key fallback |
| `baseUrl` | `string` | `""` | Optional base URL override. Empty means "use the plugin default" |

## Runtime Behavior

1. `resolveAgentConfig()` reads the connected Provider Node and produces a `ResolvedProviderConfig` inside `AgentConfig.provider`.
2. `validateAgentRuntimeGraph()` enforces runtime rules separately from config resolution:
   - one Provider Node is required
   - multiple Provider Nodes are invalid
   - `pluginId` cannot be empty
3. The server provider registry loads enabled plugins from `providers.json` and exposes client-safe summaries through `/api/providers`.
4. Provider catalogs are cached per provider instance using `pluginId + normalizedBaseUrl`, not just the provider id.
5. At runtime the server resolves the actual base URL and API key from saved keys and/or the configured env var name.

## Connections

- Sends to: Agent Node
- Receives from: None
- Provider Nodes connect only to Agent Nodes, not to other peripheral nodes
- An agent must have exactly one connected Provider Node to run

## Example

```json
{
  "type": "provider",
  "label": "OpenRouter",
  "pluginId": "openrouter",
  "authMethodId": "api-key",
  "envVar": "OPENROUTER_API_KEY",
  "baseUrl": ""
}
```
