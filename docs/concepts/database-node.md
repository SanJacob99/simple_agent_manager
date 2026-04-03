# Database Node

> Configures a traditional database connection for an agent — supports relational, document, and browser-local storage types.

<!-- source: src/types/nodes.ts#DatabaseNodeData -->
<!-- last-verified: 2026-04-03 -->

## Overview

The Database Node attaches a data storage backend to an agent. It supports six database types spanning server-side relational databases, document stores, browser-local storage, and REST API endpoints. Multiple Database Nodes can be connected to a single agent for accessing different data sources.

This node is designed for structured data storage — for vector/embedding storage, use the Vector Database Node instead.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Database"` | Display label on the canvas |
| `dbType` | `string` | `"indexeddb"` | Database type: `postgresql`, `mysql`, `sqlite`, `mongodb`, `indexeddb`, `rest-api` |
| `connectionString` | `string` | `""` | Connection string or URL for the database |

## Runtime Behavior

Not yet implemented at runtime. During config resolution (`src/utils/graph-to-agent.ts`), Database Nodes are collected into the `databases` array of the `AgentConfig` as `ResolvedDatabaseConfig` objects containing the label, dbType, and connectionString. The runtime does not yet act on this configuration.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- Multiple Database Nodes can connect to the same agent.

## Example

```json
{
  "type": "database",
  "label": "User Data",
  "dbType": "postgresql",
  "connectionString": "postgresql://user:pass@localhost:5432/mydb"
}
```
