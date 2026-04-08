# Storage Node

> Provides filesystem-based persistence for agent sessions, routed transcripts, and memory files.

<!-- source: src/types/nodes.ts#StorageNodeData -->
<!-- last-verified: 2026-04-08 -->

## Overview

The Storage Node defines where an agent's session metadata, transcript files, and memory documents live on disk. Without a connected Storage Node, the chat drawer is blocked because the backend has nowhere to persist routed sessions.

The default `storagePath` can be configured globally in **Settings -> Defaults** so that new storage nodes use a custom path automatically.

The filesystem backend keeps metadata and transcript history separate:

- `sessions.json` stores the current `sessionKey -> SessionStoreEntry` map for the agent
- transcript `.jsonl` files store the append-only conversation tree for each routed session
- Markdown files under `memory/` store evergreen and daily memory content

Only one Storage Node can be connected per agent. For embedding or semantic retrieval storage, use a Vector Database Node instead.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Storage"` | Display label on the canvas |
| `backendType` | `StorageBackend` | `"filesystem"` | Storage backend (currently filesystem only) |
| `storagePath` | `string` | `"~/.simple-agent-manager/storage"` | Root directory for agent data. `~` expands during config resolution. |
| `sessionRetention` | `number` | `50` | Max routed sessions to retain before pruning older metadata entries |
| `memoryEnabled` | `boolean` | `true` | Whether to create and manage memory `.md` files |
| `dailyMemoryEnabled` | `boolean` | `true` | Whether to maintain `YYYY-MM-DD.md` daily log files |
| `dailyResetEnabled` | `boolean` | `true` | Whether routed sessions should reset after the daily cutoff |
| `dailyResetHour` | `number` | `4` | Hour of day (0-23) used for daily reset checks |
| `idleResetEnabled` | `boolean` | `false` | Whether inactive sessions should auto-reset |
| `idleResetMinutes` | `number` | `60` | Idle timeout in minutes before an automatic reset |
| `parentForkMaxTokens` | `number` | `100000` | Max token count for carrying the prior transcript forward as `parentSession` on reset |

## Runtime Behavior

During config resolution (`src/utils/graph-to-agent.ts`), the Storage Node becomes `AgentConfig.storage`.

At runtime, three pieces work together:

- `StorageEngine` manages `sessions.json`, transcript path resolution, retention, and memory-file I/O.
- `SessionRouter` maps inbound chat traffic onto stable `sessionKey` values such as `agent:<agent-id>:main`, applies daily/idle reset rules, and updates token/cost metadata.
- `SessionTranscriptStore` provisions transcript files immediately and snapshots `SessionManager` state so empty or user-only sessions still exist on disk.

The resulting directory layout is:

- `<storagePath>/<agent-name>/sessions/sessions.json`
- `<storagePath>/<agent-name>/sessions/<timestamp>_<session-id>.jsonl`
- `<storagePath>/<agent-name>/memory/MEMORY.md`
- `<storagePath>/<agent-name>/memory/YYYY-MM-DD.md`

The frontend session store caches metadata and transcript messages by `sessionKey`. It keeps optimistic messages locally during streaming, then refreshes transcript state from the backend when a run settles.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- One Storage Node per agent

## Example

```json
{
  "type": "storage",
  "label": "Storage",
  "backendType": "filesystem",
  "storagePath": "~/.simple-agent-manager/storage",
  "sessionRetention": 50,
  "memoryEnabled": true,
  "dailyMemoryEnabled": true,
  "dailyResetEnabled": true,
  "dailyResetHour": 4,
  "idleResetEnabled": false,
  "idleResetMinutes": 60,
  "parentForkMaxTokens": 100000
}
```
