# Connector Node

> Attaches an external service connector to an agent — a generic integration point for REST APIs and other services.

<!-- source: src/types/nodes.ts#ConnectorsNodeData -->
<!-- last-verified: 2026-05-07 -->

## Overview

The Connector Node provides a generic, extensible way to attach external service integrations to an agent. Unlike the typed Database or Vector Database nodes, connectors use a freeform `connectorType` string and a `config` key-value record, making them suitable for arbitrary integrations (REST APIs, webhooks, third-party services, etc.).

Multiple Connector Nodes can be connected to a single agent, each representing a different external service.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Connector"` | Display label on the canvas |
| `connectorType` | `string` | `"rest-api"` | Type of connector (freeform string) |
| `config` | `Record<string, string>` | `{}` | Key-value configuration for the connector |

## Runtime Behavior

Not yet implemented at runtime. During config resolution (`src/utils/graph-to-agent.ts`), Connector Nodes are collected into the `connectors` array of the `AgentConfig` as `ResolvedConnectorConfig` objects containing the label, connector type, and config record. The runtime does not yet act on this configuration.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- Multiple Connector Nodes can connect to the same agent.

## Example

```json
{
  "type": "connectors",
  "label": "Slack Webhook",
  "connectorType": "webhook",
  "config": {
    "url": "https://hooks.slack.com/services/...",
    "method": "POST"
  }
}
```
