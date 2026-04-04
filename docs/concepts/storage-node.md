# Storage Node

> Provides filesystem-based persistence for agent sessions, messages, and memory files.

<!-- source: src/types/nodes.ts#StorageNodeData -->
<!-- last-verified: 2026-04-04 -->

## Overview

The Storage Node is a required peripheral that defines where an agent's data is persisted. Without a connected Storage Node, the agent chat is blocked (blurred overlay). It replaces the previous Database Node with a fully functional persistence layer.

The default backend is filesystem-based: sessions are stored as JSONL files, session metadata lives in a `_index.json` manifest, and memory files are plain Markdown. This design works cross-platform (Linux, Windows, macOS), requires zero external dependencies, and produces human-readable files.

Only one Storage Node can be connected per agent (singular, like Context Engine). For vector/embedding storage, use the Vector Database Node instead.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Storage"` | Display label on the canvas |
| `backendType` | `StorageBackend` | `"filesystem"` | Storage backend (only `filesystem` for now) |
| `storagePath` | `string` | `"~/.simple-agent-manager/storage"` | Root directory for all files. `~` is expanded to home dir during config resolution. |
| `sessionRetention` | `number` | `50` | Max sessions per agent before oldest are pruned |
| `memoryEnabled` | `boolean` | `true` | Whether to create and manage memory `.md` files |
| `dailyMemoryEnabled` | `boolean` | `true` | Whether to maintain `YYYY-MM-DD.md` daily log files |

## Runtime Behavior

During config resolution (`src/utils/graph-to-agent.ts`), the Storage Node is resolved into a `ResolvedStorageConfig` on `AgentConfig.storage`. The `~` in `storagePath` is expanded to the user's home directory using `os.homedir()`.

At runtime, the `StorageEngine` class (`src/runtime/storage-engine.ts`) handles all filesystem I/O:

- **Directory structure**: `<storagePath>/<agent-name>/sessions/` and `<storagePath>/<agent-name>/memory/`
- **Session index**: `_index.json` — array of session metadata (IDs, timestamps, token counts, cost, skills snapshot)
- **Session transcripts**: `<session-id>.jsonl` — append-only JSONL files with typed entries (session header, model changes, messages, etc.). Managed by the Gateway via SessionManager; StorageEngine does raw read/write only.
- **Memory files**: `MEMORY.md` (long-term, evergreen), `YYYY-MM-DD.md` (daily, append-only), and other `.md` files (evergreen topics)

The Zustand session store (`src/store/session-store.ts`) acts as a thin in-memory cache that delegates all persistence to the `StorageEngine`.

## Connections

- **Sends to**: Agent Node (singular — one Storage Node per agent)
- **Receives from**: None

## Example

```json
{
  "type": "storage",
  "label": "Storage",
  "backendType": "filesystem",
  "storagePath": "~/.simple-agent-manager/storage",
  "sessionRetention": 50,
  "memoryEnabled": true,
  "dailyMemoryEnabled": true
}
```
