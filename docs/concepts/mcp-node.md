# MCP Node

> Attaches an agent to a Model Context Protocol server — either a local subprocess or a remote HTTP/SSE endpoint — so the agent can call its tools.

<!-- source: src/types/nodes.ts#MCPNodeData -->
<!-- last-verified: 2026-04-22 -->

## Overview

The MCP node bridges an agent to an external MCP server. It abstracts over the transport: a `stdio` MCP server is spawned locally from a command + args (e.g. `npx @modelcontextprotocol/server-filesystem /tmp`), while `http` and `sse` transports speak to a remote endpoint over HTTP. Multiple MCP nodes may be connected to the same agent — each contributes its tools, optionally prefixed to avoid name collisions.

The node surfaces a live connection hint on the canvas. The runtime publishes `mcp:status` events (see `shared/protocol.ts#McpStatusEvent`), and the node displays a colored status dot — gray (unknown), amber pulsing (connecting), green (connected), or red (error) — next to a transport marker (`L` for local, `R` for remote).

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"MCP"` | Display name for the node |
| `transport` | `'stdio' \| 'http' \| 'sse'` | `'stdio'` | Transport used to reach the server |
| `command` | `string` | `""` | **stdio only.** Executable to launch (e.g. `npx`) |
| `args` | `string[]` | `[]` | **stdio only.** Arguments passed to `command` |
| `env` | `Record<string, string>` | `{}` | **stdio only.** Extra env vars for the subprocess |
| `cwd` | `string` | `""` | **stdio only.** Working dir. Empty = inherit server cwd |
| `url` | `string` | `""` | **http/sse only.** Full endpoint URL |
| `headers` | `Record<string, string>` | `{}` | **http/sse only.** Extra HTTP headers (e.g. auth) |
| `toolPrefix` | `string` | `""` | Prefix applied to every exported tool name |
| `allowedTools` | `string[]` | `[]` | Whitelist of tool names to expose. Empty = all |
| `autoConnect` | `boolean` | `true` | Connect when the agent starts |

Properties are derived from the TypeScript interface in `src/types/nodes.ts` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`resolveAgentConfig()` in `src/utils/graph-to-agent.ts` collects every connected MCP node into `AgentConfig.mcps: ResolvedMcpConfig[]`, preserving the node id as `mcpNodeId` so the server can route `mcp:status` events back to the correct node on the canvas.

The actual MCP client (subprocess spawn for stdio, HTTP/SSE client for remote) is **not yet implemented at runtime**. When the server-side MCP manager is added, it should:

1. On agent start, iterate `AgentConfig.mcps` and connect to each server whose `autoConnect` is true.
2. Emit `{ type: 'mcp:status', agentId, mcpNodeId, status: 'connecting' | 'connected' | 'error' | 'disconnected' }` whenever the transport state changes.
3. Expose the server's tools through the tool factory, applying `toolPrefix` and filtering by `allowedTools` if set.

The UI side is already wired: `src/store/agent-connection-store.ts` tracks status per `mcpNodeId`, and `src/nodes/MCPNode.tsx` reads from it to render the hint.

## Connections

Peripheral → Agent. One edge per MCP server. An agent can attach any number of MCP nodes; tool name collisions are resolved by setting distinct `toolPrefix` values.

## Example

A local filesystem MCP server scoped to `/tmp`:

```json
{
  "label": "fs",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  "env": {},
  "cwd": "",
  "toolPrefix": "fs_",
  "allowedTools": [],
  "autoConnect": true
}
```

A remote HTTP MCP server with a bearer token:

```json
{
  "label": "search-mcp",
  "transport": "http",
  "url": "https://mcp.example.com/rpc",
  "headers": { "Authorization": "Bearer sk-..." },
  "toolPrefix": "",
  "allowedTools": ["web_search", "web_fetch"],
  "autoConnect": true
}
```
