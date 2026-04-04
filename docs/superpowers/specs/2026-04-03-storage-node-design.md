# Storage Node Design

> Replaces the placeholder `database` node with a full persistence layer for agent sessions, messages, and memory files.

## Context

The current session store uses Zustand + `persist` middleware (localStorage). This has size limits, no cross-session file persistence, and doesn't scale. The storage node becomes a required peripheral that owns all persistence — sessions, messages, and memory markdown files. Without it connected, the agent chat is blocked.

The approach is **Hybrid (C)**: direct filesystem implementation now, structured so a future interface extraction for DB backends (SQLite, PostgreSQL) is a refactor, not a rewrite.

---

## 1. Node Definition & Configuration

**Node type key:** `storage` (replaces `database`)

### `StorageNodeData`

| Field                | Type          | Default                              | Purpose                                                |
| -------------------- | ------------- | ------------------------------------ | ------------------------------------------------------ |
| `type`               | `'storage'`   | —                                    | Node discriminant                                      |
| `label`              | `string`      | `'Storage'`                          | Display name                                           |
| `backendType`        | `'filesystem'` | `'filesystem'`                       | Storage backend (only FS for now)                      |
| `storagePath`        | `string`      | `'~/.simple-agent-manager/storage'`  | Root directory for all files                           |
| `sessionRetention`   | `number`      | `50`                                 | Max sessions per agent before oldest are pruned        |
| `memoryEnabled`      | `boolean`     | `true`                               | Whether to create/manage memory `.md` files            |
| `dailyMemoryEnabled` | `boolean`     | `true`                               | Whether to maintain `YYYY-MM-DD.md` daily logs         |

### Blurred overlay sequence (ChatDrawer)

1. Context Engine not connected → blocked
2. Storage not connected → blocked
3. ~~Tools not connected~~ — **removed**

---

## 2. Directory Structure & File Formats

### Filesystem layout

```
<storagePath>/
  <agent-name>/
    sessions/
      _index.json                 # session metadata array
      <session-id>.jsonl          # messages for one session
    memory/
      MEMORY.md                   # long-term curated (evergreen)
      2026-04-03.md               # daily notes (append-only)
      projects.md                 # evergreen topic files (no decay)
```

### `_index.json` — session metadata

```jsonc
[
  {
    "sessionId": "2d1fb59e-bf9e-4d84-b68c-f88019c5c536",
    "agentName": "my-agent",
    "llmSlug": "anthropic/claude-sonnet-4-20250514",
    "startedAt": "2026-04-03T10:00:00.000Z",
    "updatedAt": "2026-04-03T10:15:00.000Z",
    "sessionFile": "sessions/2d1fb59e-bf9e-4d84-b68c-f88019c5c536.jsonl",
    "skillsSnapshot": {
      "version": 0,
      "prompt": "<available_skills>...</available_skills>",
      "skills": [{ "name": "code_generation", "requiredEnv": [] }],
      "resolvedSkills": [
        {
          "name": "code_generation",
          "description": "Generate code from natural language",
          "filePath": "/skills/code_generation/SKILL.md",
          "baseDir": "/skills/code_generation",
          "source": "bundled",
          "disableModelInvocation": false
        }
      ]
    },
    "contextTokens": 45200,
    "systemPromptReport": {
      "skills": {
        "promptChars": 6369,
        "entries": [{ "name": "code_generation", "blockChars": 214 }]
      },
      "tools": {
        "listChars": 1200,
        "schemaChars": 8400,
        "entries": [
          { "name": "read_file", "summaryChars": 120, "schemaChars": 340, "propertyCount": 3 }
        ]
      }
    },
    "totalInputTokens": 12500,
    "totalOutputTokens": 3200,
    "cacheRead": 8000,
    "cacheWrite": 2000,
    "totalEstimatedCostUsd": 0.042,
    "totalTokens": 15700
  }
]
```

### `<session-id>.jsonl` — message log

One JSON object per line. Linear chain via `parentId` (each entry points to previous entry's `id`).

| Entry type              | Purpose                                           |
| ----------------------- | ------------------------------------------------- |
| `session`               | Header — version, session ID, timestamp, cwd      |
| `model_change`          | Provider/model switch                             |
| `thinking_level_change` | Thinking level adjustment                         |
| `custom`                | Extensible events (e.g. `model-snapshot`)          |
| `message`               | User or assistant message with content blocks, usage, cost |

### Memory files

- **`MEMORY.md`** — Long-term curated, plain markdown, agent-chosen structure. Loaded in main/private sessions only. Evergreen (no decay).
- **`YYYY-MM-DD.md`** — Append-only daily log. Read at session start (today + yesterday). Filename drives temporal decay.
- **Other `.md` files** (e.g. `projects.md`) — Evergreen topic files, no decay.

Memory files are raw markdown with no required schema or frontmatter. The vector database node (separate concern) handles chunking (~400-token segments, 80-token overlap) and embedding. The memory node handles retrieval with decay.

---

## 3. StorageEngine Runtime Class

**File:** `src/runtime/storage-engine.ts`

No React dependency. Receives resolved config, returns plain data. All methods are `async`.

### Methods

| Method               | Signature                                              | Purpose                                                 |
| -------------------- | ------------------------------------------------------ | ------------------------------------------------------- |
| `constructor`        | `(config: ResolvedStorageConfig)`                      | Ensures directory structure exists (`storagePath` already expanded) |
| `listSessions`       | `() → SessionMeta[]`                                   | Reads `_index.json`, sorted by `updatedAt` desc         |
| `createSession`      | `(meta: SessionMeta) → void`                           | Appends to `_index.json`, creates `.jsonl` with header  |
| `deleteSession`      | `(sessionId: string) → void`                           | Removes from index, deletes `.jsonl` file               |
| `getSessionMeta`     | `(sessionId: string) → SessionMeta \| null`            | Single session lookup from index                        |
| `updateSessionMeta`  | `(sessionId: string, partial: Partial<SessionMeta>) → void` | Updates token counts, cost, timestamps in index    |
| `appendEntry`        | `(sessionId: string, entry: SessionEntry) → void`      | Appends one JSONL line to session file                  |
| `readEntries`        | `(sessionId: string) → SessionEntry[]`                 | Reads all JSONL lines from session file                 |
| `enforceRetention`   | `(maxSessions: number) → void`                         | Prunes oldest sessions beyond limit                     |
| `appendDailyMemory`  | `(content: string, date?: string) → void`              | Appends to `YYYY-MM-DD.md` (defaults to today)          |
| `readDailyMemory`    | `(date: string) → string \| null`                      | Reads a specific daily file                             |
| `readLongTermMemory` | `() → string \| null`                                  | Reads `MEMORY.md`                                       |
| `writeLongTermMemory`| `(content: string) → void`                             | Overwrites `MEMORY.md`                                  |
| `listMemoryFiles`    | `() → MemoryFileInfo[]`                                | Lists `.md` files in `memory/` with metadata            |

### Design decisions

- `_index.json` is read into memory on first access, written back on every mutation. No file locking (single-user desktop app).
- JSONL files are append-only for writes, full-read for loads. **TODO: optimize with streaming/partial reads for very large sessions.**
- `parentId` on each entry is the previous entry's `id` (linear chain only).
- `~` expansion happens during graph-to-agent resolution (before the engine receives the config). `ResolvedStorageConfig.storagePath` is always an absolute path.
- All methods `async` — keeps signatures compatible with future DB backends.

### Not in scope

- Embedding/chunking → vector database node
- Retrieval with decay → memory node
- React state management → session store (thin cache)

---

## 4. Integration

### Resolved config (`agent-config.ts`)

```ts
export interface ResolvedStorageConfig {
  label: string;
  backendType: 'filesystem';
  storagePath: string;          // ~ already expanded
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;
}
```

`AgentConfig`: `databases: ResolvedDatabaseConfig[]` → `storage: ResolvedStorageConfig | null` (singular).

### Graph-to-agent resolution

Find connected `storage` node (singular, like `contextEngine`). Resolve into `ResolvedStorageConfig`. Remove old `databases` array.

### Session store

The Zustand `session-store.ts` becomes a thin in-memory cache:

- On chat open: `StorageEngine.listSessions()` → populate store
- On message send/receive: update store for UI reactivity + `StorageEngine.appendEntry()` for persistence
- On session create/delete: store update + `StorageEngine` call
- `persist` middleware **removed** — `StorageEngine` is source of truth
- Same public API preserved so `ChatDrawer` doesn't need major refactoring

### Chat Drawer overlay

- **Add** storage gate: "A Storage node defines where sessions, messages, and memory files are persisted. Without it, the agent has nowhere to save conversation history."
- **Remove** tools gate

### Node UI

- `DatabaseNode.tsx` → `StorageNode.tsx` (icon: `Database` from lucide)
- `DatabaseProperties.tsx` → `StorageProperties.tsx` (fields: backendType, storagePath, sessionRetention, memoryEnabled, dailyMemoryEnabled)
- `node-registry.ts`: `database` → `storage`

---

## 5. Cleanup & Migration

### Removed artifacts

- `DatabaseNodeData`, `DatabaseNode.tsx`, `DatabaseProperties.tsx`, `ResolvedDatabaseConfig`
- `databases` array in `AgentConfig`
- `persist` middleware from `session-store.ts`
- `'database'` from `NodeType` union
- Tools overlay block in `ChatDrawer`

### Existing graph migration

No migration needed — `database` nodes are dev-only placeholders with no real data. Old graphs won't load the removed type.

### Concept docs

- `database-node.md` → rewritten as `storage-node.md`
- `_manifest.json`: `database` → `storage`

### Files touched

| File | Change |
| ---- | ------ |
| `src/types/nodes.ts` | Replace `database` → `storage`, `DatabaseNodeData` → `StorageNodeData` |
| `src/utils/default-nodes.ts` | Replace `database` case → `storage` with new defaults |
| `src/runtime/agent-config.ts` | Replace `ResolvedDatabaseConfig` → `ResolvedStorageConfig`, `databases[]` → `storage \| null` |
| `src/runtime/storage-engine.ts` | **New file** — all filesystem I/O |
| `src/utils/graph-to-agent.ts` | Replace database resolution → storage (singular) |
| `src/store/session-store.ts` | Remove persist middleware, delegate to `StorageEngine` |
| `src/nodes/DatabaseNode.tsx` → `StorageNode.tsx` | Rename + update |
| `src/panels/property-editors/DatabaseProperties.tsx` → `StorageProperties.tsx` | Rename + new fields |
| `src/nodes/node-registry.ts` | `database` → `storage` |
| `src/chat/ChatDrawer.tsx` | Add storage gate, remove tools gate |
| `src/utils/theme.ts` | `database` color → `storage` |
| `docs/concepts/database-node.md` → `storage-node.md` | Rewrite |
| `docs/concepts/_manifest.json` | Update entry |
