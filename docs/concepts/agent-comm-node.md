# Agent Communication Node

> Enables inter-agent messaging between agents in the same graph, using direct or broadcast protocols.

<!-- source: src/types/nodes.ts#AgentCommNodeData -->
<!-- last-verified: 2026-04-03 -->

## Overview

The Agent Communication Node configures how an agent can communicate with other agents in the graph. It supports two protocols: **direct** messaging (one-to-one, targeting a specific agent by node ID) and **broadcast** (one-to-many, sending to all agents).

This node enables multi-agent workflows where agents can delegate tasks, share findings, or coordinate actions. Multiple Agent Comm Nodes can be connected to a single agent, each targeting a different peer.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Agent Comm"` | Display label on the canvas |
| `targetAgentNodeId` | `string \| null` | `null` | Node ID of the target agent for direct protocol |
| `protocol` | `string` | `"direct"` | Communication protocol: `direct` or `broadcast` |

## Runtime Behavior

Not yet implemented at runtime. During config resolution (`src/utils/graph-to-agent.ts`), Agent Comm Nodes are collected into the `agentComm` array of the `AgentConfig` as `ResolvedAgentCommConfig` objects. The runtime does not yet act on this configuration — it is reserved for future multi-agent orchestration support.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- Multiple Agent Comm Nodes can connect to the same agent (e.g., one per target agent).

## Example

```json
{
  "type": "agentComm",
  "label": "Talk to Researcher",
  "targetAgentNodeId": "node-abc123",
  "protocol": "direct"
}
```
