# Memory Node

> Gives an agent persistent memory — long-term storage, session message management, compaction, and searchable recall via exposed tools.

<!-- source: src/types/nodes.ts#MemoryNodeData -->
<!-- last-verified: 2026-04-23 -->

## Overview

The Memory Node configures how an agent remembers information across turns and sessions. When connected to an agent, it creates a `MemoryEngine` at runtime that manages two layers of memory: **long-term storage** (key-value entries with metadata) and **session messages** (recent conversation history with a configurable max).

The memory node can expose up to three tools to the agent — `memory_search`, `memory_get`, and `memory_save` — allowing the agent to actively manage its own memory during conversations. It also supports compaction strategies that summarize or trim older messages when history grows too large.

Three backends are available: `builtin` (in-memory Map, suitable for development), `external` (delegates to a user-provided REST endpoint), and `cloud` (for managed memory services). Currently only the builtin backend is fully implemented.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Memory"` | Display label on the canvas |
| `backend` | `MemoryBackend` | `"builtin"` | Storage backend: `builtin`, `external`, or `cloud` |
| `maxSessionMessages` | `number` | `100` | Maximum session messages before trimming |
| `persistAcrossSessions` | `boolean` | `false` | Whether memory persists between sessions |
| `compactionEnabled` | `boolean` | `false` | Enable automatic message compaction |
| `compactionStrategy` | `string` | `"summary"` | Strategy: `summary` or `sliding-window` |
| `compactionThreshold` | `number` | `0.8` | Usage ratio that triggers compaction (0-1) |
| `exposeMemorySearch` | `boolean` | `true` | Give the agent a `memory_search` tool |
| `exposeMemoryGet` | `boolean` | `true` | Give the agent a `memory_get` tool |
| `exposeMemorySave` | `boolean` | `true` | Give the agent a `memory_save` tool |
| `searchMode` | `string` | `"hybrid"` | Search algorithm: `keyword`, `semantic`, or `hybrid` |
| `externalEndpoint` | `string` | `""` | REST endpoint for external/cloud backends |
| `externalApiKey` | `string` | `""` | API key for external/cloud backends |

## Runtime Behavior

At runtime, the Memory Node configuration is resolved into a `ResolvedMemoryConfig` and used to instantiate a `MemoryEngine` (`src/runtime/memory-engine.ts`).

**Long-term storage**: The `MemoryEngine` maintains a `Map<string, MemoryEntry>` where each entry has a `key`, `content`, `metadata`, and `timestamp`. Entries are saved, retrieved, and searched through the exposed memory tools.

**Session messages**: Messages are stored per session ID with automatic trimming to `maxSessionMessages`. When the limit is exceeded, oldest messages are dropped.

**Compaction strategies**:
- `sliding-window`: Keeps the most recent 30% of messages, drops the rest with a placeholder note
- `summary`: Summarizes older messages into a system message, keeps recent 30%

**Memory tools** (created by `MemoryEngine.createMemoryTools()`):
- `memory_search` — Keyword search over long-term entries, returns top 10 by recency
- `memory_get` — Retrieve a specific entry by key
- `memory_save` — Store a key-value entry to long-term memory

These tools are injected alongside the agent's other tools during runtime creation.

## Connections

- **Sends to**: Agent Node (the agent that owns this memory)
- **Receives from**: None
- At most one Memory Node should be connected to an agent. If multiple are connected, only the first one found is used.

## Example

```json
{
  "type": "memory",
  "label": "Research Memory",
  "backend": "builtin",
  "maxSessionMessages": 50,
  "persistAcrossSessions": false,
  "compactionEnabled": true,
  "compactionStrategy": "sliding-window",
  "compactionThreshold": 0.8,
  "exposeMemorySearch": true,
  "exposeMemoryGet": true,
  "exposeMemorySave": true,
  "searchMode": "keyword",
  "externalEndpoint": "",
  "externalApiKey": ""
}
```
