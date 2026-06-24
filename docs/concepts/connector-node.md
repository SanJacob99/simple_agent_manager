# Connector Node

> Attaches a curated external integration to an agent — a named entry from the connector catalog that resolves into an MCP server under the hood.

<!-- source: src/types/nodes.ts#ConnectorsNodeData -->
<!-- last-verified: 2026-06-24 -->

## Overview

The Connector Node is a curated MCP preset. Each connector is a named entry in the catalog (`shared/connectors/catalog.ts`) that knows how to launch a specific MCP server, what variables the user needs to provide, and where to read secrets from. The user picks an entry by `connectorId` (currently: `github`) and the runtime translates the node into a `ResolvedMcpConfig` appended to `AgentConfig.mcps[]`.

This is distinct from the MCP node, which lets power users wire arbitrary MCP servers directly. Both kinds of nodes coexist and end up in the same `mcps[]` collection at runtime.

Multiple Connector Nodes can connect to a single agent — each one launches its own MCP server.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Connector"` | Display label on the canvas (also passed through to MCP `label`). |
| `connectorId` | `string` | `""` | Catalog ID. Empty means "not yet selected"; surfaces a validation error. |
| `config` | `Record<string, string>` | `{}` | Per-instance overrides for variables declared by the catalog entry. Keys are catalog-defined (e.g. `tokenEnvVar`). |

Defaults come from `src/utils/default-nodes.ts`.

## Runtime Behavior

During config resolution (`src/utils/graph-to-agent.ts`), each connector node connected to the agent is:

1. Looked up in `CONNECTOR_CATALOG` by `connectorId`. Unknown / empty IDs are skipped here and surfaced separately by `validateAgentRuntimeGraph` as `unknown_connector` / `unselected_connector` errors.
2. Materialized into a `ResolvedMcpConfig`:
   - `mcpNodeId` = the connector node's id.
   - `transport`, `command`, `args`, `url` = the catalog entry's `mcp` template.
   - `env` = output of the catalog entry's `buildEnv(values)` — typically reads a token from `process.env` and returns `{ <ENV_VAR_NAME>: <token> }`. Secrets are never persisted in the graph file.
   - `toolPrefix` = the catalog entry's `toolPrefix` (e.g. `github_`).
   - `allowedTools` = `[]` (no whitelist).
   - `autoConnect` = `true`.
3. Appended to the same `mcps[]` the MCP node populates. The MCP runtime under `server/runtime/...` handles spawn, tool registration, and `mcp:status` events.

The connector node has no live connection-status indicator yet.

## Catalog (v1)

| ID | Description | Variables |
|----|-------------|-----------|
| `github` | Read repos, search code, manage issues and PRs. | `tokenEnvVar` (default `GITHUB_PERSONAL_ACCESS_TOKEN`) |

To use the GitHub connector, set the env var on the SAM server process before starting it:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...
npm run dev
```

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- Multiple Connector Nodes can connect to the same agent.

## Example

```json
{
  "type": "connectors",
  "label": "My GitHub",
  "connectorId": "github",
  "config": {
    "tokenEnvVar": "GITHUB_PERSONAL_ACCESS_TOKEN"
  }
}
```
