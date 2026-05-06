# Storage Node

> Provides filesystem-based persistence for agent sessions, routed transcripts, and memory files.

<!-- source: src/types/nodes.ts#StorageNodeData -->
<!-- last-verified: 2026-05-06 -->

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
| `dailyResetEnabled` | `boolean` | `false` | Whether routed sessions should reset after the daily cutoff. Off by default so sessions persist across days. |
| `dailyResetHour` | `number` | `4` | Hour of day (0-23) used for daily reset checks |
| `idleResetEnabled` | `boolean` | `false` | Whether inactive sessions should auto-reset |
| `idleResetMinutes` | `number` | `60` | Idle timeout in minutes before an automatic reset |
| `parentForkMaxTokens` | `number` | `100000` | Max token count for carrying the prior transcript forward as `parentSession` on reset |
| `maintenanceMode` | `'warn' \| 'enforce'` | `"warn"` | How quota violations are handled: `warn` logs them, `enforce` also evicts to bring usage back in bounds |
| `pruneAfterDays` | `number` | `30` | Sessions last updated more than this many days ago are pruned during maintenance |
| `maxEntries` | `number` | `500` | Max session entries to retain; oldest are removed when exceeded. `0` = unlimited |
| `rotateBytes` | `number` | `10485760` | `sessions.json` is rotated (archived and replaced) when it exceeds this size in bytes |
| `resetArchiveRetentionDays` | `number` | `30` | How long archived `sessions.json` snapshots are kept before deletion |
| `maxDiskBytes` | `number` | `0` | Total disk budget for the agent's storage directory in bytes. `0` = unlimited |
| `highWaterPercent` | `number` | `80` | When `maxDiskBytes` is set, maintenance evicts sessions until usage drops below this percentage of the budget |
| `maintenanceIntervalMinutes` | `number` | `60` | How often the background maintenance task runs, in minutes |

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

The frontend session store caches metadata and transcript messages by `sessionKey`. It keeps optimistic messages locally during streaming, then refreshes transcript state from the backend when a run settles. When a user switches sessions, the store hydrates transcripts for sessions that have not been loaded yet, but reuses already-cached messages for previously opened sessions so switching back does not require another full transcript fetch.

When a user deletes an agent from the canvas and confirms "delete agent and data", the frontend now calls a dedicated backend endpoint that removes the entire `<storagePath>/<agent-name>/` directory, including `sessions/`, transcript files, and any `memory/` documents. The server also clears cached `StorageEngine`, `SessionTranscriptStore`, and `SessionRouter` instances for that agent so a future agent with the same name starts from a clean filesystem state.

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
  "dailyResetEnabled": false,
  "dailyResetHour": 4,
  "idleResetEnabled": false,
  "idleResetMinutes": 60,
  "parentForkMaxTokens": 100000,
  "maintenanceMode": "warn",
  "pruneAfterDays": 30,
  "maxEntries": 500,
  "rotateBytes": 10485760,
  "resetArchiveRetentionDays": 30,
  "maxDiskBytes": 0,
  "highWaterPercent": 80,
  "maintenanceIntervalMinutes": 60
}
```
