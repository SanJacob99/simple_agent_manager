# Session Management Design

**Date:** 2026-04-07
**Scope:** Session store schema, sessionKey routing, session lifecycle (resets), session status read path
**Deferred:** Session tools (sessions_list, sessions_send, etc.), cron/webhook sessions, maintenance controls (pruneAfter, maxDiskBytes), tree navigation UI

## Overview

Sessions route inbound messages to isolated conversation buckets. Each session is identified by a `sessionKey` (routing) and backed by a `sessionId` (transcript file). The Gateway owns all session state; UI clients query it.

This design covers the foundation layer: the persistent store, the routing logic, reset lifecycle, and the read path for session status.

### Architecture

```
Inbound message
  -> SessionRouter (resolve key, check resets, find/create session)
    -> StorageEngine (read/write sessions.json)
    -> SessionManager (open/create transcript .jsonl)  [pi-coding-agent]
  -> AgentRuntime (run with resolved sessionId + transcript)
```

Three components with clear responsibilities:

| Component | Owns | Does not own |
|-----------|------|--------------|
| **SessionRouter** | Routing logic, reset checks, session lifecycle | Persistence, transcript I/O |
| **StorageEngine** | `sessions.json` I/O, transcript path resolution, retention, memory files | Routing decisions, JSONL parsing |
| **SessionManager** (pi-mono) | Transcript I/O, tree structure, compaction entries | Session metadata, routing |

---

## 1. SessionStoreEntry Schema

The store file changes from `_index.json` (a `SessionMeta[]` array) to `sessions.json` (a `Record<string, SessionStoreEntry>` map keyed by `sessionKey`).

### Interface

```typescript
// shared/storage-types.ts

export interface SessionSkillsSnapshot {
  version: number;
  prompt: string;
  skills: { name: string; requiredEnv: string[]; primaryEnv?: string }[];
  resolvedSkills: {
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    source?: string;
    disableModelInvocation?: boolean;
  }[];
}

export interface SessionSystemPromptReport {
  skills: {
    promptChars: number;
    entries: { name: string; blockChars: number }[];
  };
  tools: {
    listChars: number;
    schemaChars: number;
    entries: { name: string; summaryChars: number; schemaChars: number; propertyCount: number }[];
  };
}

export interface SessionStoreEntry {
  // --- Identity ---
  sessionKey: string;                    // routing key: "agent:<agentId>:main", "cron:<jobId>", etc.
  sessionId: string;                     // current transcript id (derives filename unless sessionFile set)
  agentId: string;                       // owning agent
  sessionFile?: string;                  // explicit transcript path override (escape hatch)

  // --- Timestamps ---
  createdAt: string;                     // ISO -- when this sessionKey was first created
  updatedAt: string;                     // ISO -- last activity

  // --- Chat metadata ---
  chatType: 'direct' | 'group' | 'room';
  provider?: string;                     // e.g. "discord", "slack"
  subject?: string;                      // group/channel subject
  room?: string;                         // room/channel id
  space?: string;                        // workspace/server id
  displayName?: string;                  // human-readable label

  // --- Toggles ---
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  sendPolicy?: string;                   // per-session override

  // --- Model selection ---
  providerOverride?: string;
  modelOverride?: string;
  authProfileOverride?: string;

  // --- Token counters (best-effort, provider-dependent) ---
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalEstimatedCostUsd: number;

  // --- Skills snapshot ---
  skillsSnapshot?: SessionSkillsSnapshot;

  // --- System prompt report ---
  systemPromptReport?: SessionSystemPromptReport;

  // --- Compaction tracking ---
  compactionCount: number;
  memoryFlushAt?: string;                // ISO -- last pre-compaction memory flush
  memoryFlushCompactionCount?: number;   // compaction count when last flush ran
}
```

### On-disk format

```json
{
  "agent:calculator-bot:main": {
    "sessionKey": "agent:calculator-bot:main",
    "sessionId": "a1b2c3d4-...",
    "agentId": "calculator-bot",
    "createdAt": "2026-04-07T10:00:00.000Z",
    "updatedAt": "2026-04-07T14:30:00.000Z",
    "chatType": "direct",
    "inputTokens": 5000,
    "outputTokens": 3000,
    "totalTokens": 8000,
    "contextTokens": 6000,
    "cacheRead": 0,
    "cacheWrite": 0,
    "totalEstimatedCostUsd": 0.02,
    "compactionCount": 1
  }
}
```

---

## 2. Storage Node Changes

The Storage node gains reset configuration fields controlling when a sessionKey gets a fresh sessionId.

### New fields on StorageNodeData

```typescript
// src/types/nodes.ts — StorageNodeData additions

export interface StorageNodeData {
  [key: string]: unknown;
  type: 'storage';
  label: string;
  backendType: StorageBackend;
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;

  // Session reset config
  dailyResetEnabled: boolean;           // default: true
  dailyResetHour: number;               // 0-23, default: 4 (4:00 AM gateway local time)
  idleResetEnabled: boolean;            // default: false
  idleResetMinutes: number;             // default: 60
  parentForkMaxTokens: number;          // default: 100000 (skip parent fork when too large; 0 = disable)
}
```

### ResolvedStorageConfig additions

```typescript
// shared/agent-config.ts — ResolvedStorageConfig additions

export interface ResolvedStorageConfig {
  label: string;
  backendType: 'filesystem';
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;

  // Session reset config
  dailyResetEnabled: boolean;
  dailyResetHour: number;
  idleResetEnabled: boolean;
  idleResetMinutes: number;
  parentForkMaxTokens: number;
}
```

### Defaults

```typescript
// src/utils/default-nodes.ts — storage case additions

dailyResetEnabled: true,
dailyResetHour: 4,
idleResetEnabled: false,
idleResetMinutes: 60,
parentForkMaxTokens: 100000,
```

The property editor (`StorageProperties.tsx`) gains a "Session Resets" section.
The `graph-to-agent.ts` resolver passes these fields through to `ResolvedStorageConfig`.

---

## 3. SessionRouter

New class at `server/runtime/session-router.ts`. Gateway-level coordinator that resolves inbound messages to a session and handles reset lifecycle.

### Responsibilities

1. **Route** -- given an agentId + routing hints, produce a sessionKey
2. **Resolve** -- look up the SessionStoreEntry for that key, or create one
3. **Check resets** -- before handing off, check if daily/idle reset has expired; if so, create a new sessionId for the existing key
4. **Status** -- read path for session metadata

### Interface

```typescript
export interface RouteRequest {
  agentId: string;
  chatType?: 'direct' | 'group' | 'room';
  subKey?: string;              // defaults to "main"
  provider?: string;            // "discord", "slack", etc.
  room?: string;
  space?: string;
}

export interface RouteResult {
  sessionKey: string;
  sessionId: string;
  transcriptPath: string;       // absolute path to .jsonl
  created: boolean;             // true if session was just created
  reset: boolean;               // true if session was just reset (daily/idle)
}

export class SessionRouter {
  constructor(
    private storageEngine: StorageEngine,
    private storageConfig: ResolvedStorageConfig,
    private agentId: string,
  ) {}

  async route(req: RouteRequest): Promise<RouteResult>;
  async resetSession(sessionKey: string, newModel?: string): Promise<RouteResult>;
  async getStatus(sessionKey: string): Promise<SessionStoreEntry | null>;
  async listSessions(): Promise<SessionStoreEntry[]>;
  async updateAfterTurn(sessionKey: string, updates: Partial<SessionStoreEntry>): Promise<void>;
}
```

### Routing logic (route method)

```
1. Build sessionKey: "agent:<agentId>:<subKey ?? 'main'>"
2. Look up entry in sessions.json via StorageEngine
3. If not found:
   -> Create new SessionStoreEntry + new transcript via SessionManager.create()
   -> Return { created: true }
4. If found, check resets:
   a. Daily: if dailyResetEnabled && updatedAt is before today's reset hour -> reset
   b. Idle: if idleResetEnabled && (now - updatedAt) > idleResetMinutes -> reset
   c. Whichever expires first wins
5. If reset triggered:
   -> New sessionId (UUID)
   -> New transcript file via SessionManager.create()
   -> If parentForkMaxTokens > 0 and old transcript under limit, set parentSession
   -> Update entry: new sessionId, fresh createdAt, zero counters, reset compactionCount
   -> Return { reset: true }
6. Otherwise:
   -> Return existing sessionId, { created: false, reset: false }
```

### Reset mechanics

- New UUID sessionId generated
- New transcript file created via `SessionManager.create()` with session header
- If `parentForkMaxTokens > 0` and old transcript is under that token count, new session header includes `parentSession` pointing to old transcript path
- SessionStoreEntry updated: new sessionId, fresh createdAt, compactionCount = 0, token counters zeroed
- Old transcript file is NOT deleted (retention/cleanup is deferred)

### Integration point

```
Chat panel sends message
  -> Server receives dispatch command
  -> SessionRouter.route({ agentId, chatType: 'direct' })
  -> Returns { sessionKey, sessionId, transcriptPath }
  -> SessionManager.open(transcriptPath) for transcript I/O
  -> AgentRuntime runs with that session
  -> On turn complete -> SessionRouter.updateAfterTurn(sessionKey, { inputTokens, ... })
```

---

## 4. StorageEngine Evolution

StorageEngine evolves to manage `sessions.json` instead of `_index.json`. JSONL methods are removed entirely in favor of pi-mono's SessionManager.

### What changes

| Current (_index.json) | New (sessions.json) |
|---|---|
| `SessionMeta[]` array | `Record<string, SessionStoreEntry>` map |
| Keyed by array index, lookup by sessionId | Keyed by sessionKey |
| `readIndex()` / `writeIndex()` | `readStore()` / `writeStore()` |
| `createSession(meta: SessionMeta)` | `createSession(entry: SessionStoreEntry)` |
| `getSessionMeta(sessionId)` | `getSession(sessionKey)` |
| `getSessionByKey(sessionKey)` | Same, now the primary lookup |
| `updateSessionMeta(sessionId, partial)` | `updateSession(sessionKey, partial)` |
| `deleteSession(sessionId)` | `deleteSession(sessionKey)` |
| `listSessions()` returns sorted array | `listSessions()` returns entries sorted by updatedAt desc |
| `createManagedSession(llmSlug)` | Removed -- orchestrated by SessionRouter |

### New method signatures

```typescript
export class StorageEngine {
  // --- Store I/O ---
  private storePath(): string;                              // sessions/sessions.json
  private readStore(): Promise<Record<string, SessionStoreEntry>>;
  private writeStore(store: Record<string, SessionStoreEntry>): Promise<void>;

  // --- Session CRUD ---
  async createSession(entry: SessionStoreEntry): Promise<void>;
  async getSession(sessionKey: string): Promise<SessionStoreEntry | null>;
  async getSessionById(sessionId: string): Promise<SessionStoreEntry | null>;
  async updateSession(sessionKey: string, partial: Partial<SessionStoreEntry>): Promise<void>;
  async deleteSession(sessionKey: string): Promise<void>;
  async listSessions(): Promise<SessionStoreEntry[]>;

  // --- Transcript path helpers ---
  resolveTranscriptPath(entry: SessionStoreEntry): string;

  // --- Retention ---
  async enforceRetention(maxSessions: number): Promise<void>;

  // --- Memory methods (unchanged) ---
  async appendDailyMemory(content: string, date?: string): Promise<void>;
  async readDailyMemory(date: string): Promise<string | null>;
  async readLongTermMemory(): Promise<string | null>;
  async writeLongTermMemory(content: string): Promise<void>;
  async listMemoryFiles(): Promise<MemoryFileInfo[]>;
}
```

### Removed methods

- `appendEntry()`, `readEntries()`, `replaceEntries()` -- all JSONL I/O replaced by SessionManager
- `createManagedSession()` -- session creation orchestrated by SessionRouter
- The optimized JSONL line parser -- no longer needed

### Cache

`indexCache: SessionMeta[]` becomes `storeCache: Record<string, SessionStoreEntry> | null`. Same lazy-read, invalidate-on-write pattern.

### resolveTranscriptPath

If `entry.sessionFile` is set, use it (absolute or relative to agent dir). Otherwise derive: `sessions/<sessionId>.jsonl`.

---

## 5. pi-mono SessionManager Integration

### Dependency

```json
"@mariozechner/pi-coding-agent": "^0.65.2"
```

Import:
```typescript
import { SessionManager } from '@mariozechner/pi-coding-agent';
```

### What SessionManager handles

| Removed from StorageEngine | Replaced by SessionManager |
|---|---|
| `appendEntry(sessionKey, entry)` | `sm.appendMessage(msg)`, `sm.appendCompaction(...)`, etc. |
| `readEntries(sessionKey)` | `sm.getEntries()`, `sm.getPath()` |
| `replaceEntries(sessionKey, entries)` | Not needed -- compaction via `sm.appendCompaction()` |
| Transcript file creation + header | `SessionManager.create(cwd)` |

### SessionManager lifecycle

The SessionRouter manages SessionManager instances:
- Creates via `SessionManager.create(sessionsDir)` for new sessions
- Opens via `SessionManager.open(transcriptPath)` for existing sessions
- Passes the instance to AgentRuntime for the duration of a turn
- After a reset, creates a new SessionManager for the fresh transcript

### ContextEngine compaction integration

When the ContextEngine compacts:
- Write the result via `sm.appendCompaction(summary, firstKeptEntryId, tokensBefore)`
- The compaction entry becomes a proper transcript entry with tree structure (id + parentId)
- ContextEngine receives the SessionManager instance (or a write callback) to persist compaction
- `SessionStoreEntry.compactionCount` is incremented via `SessionRouter.updateAfterTurn()`

---

## 6. Session Status Read Path

### API endpoints

```
GET  /api/sessions/:agentId                       -> SessionStoreEntry[]
GET  /api/sessions/:agentId/:sessionKey            -> SessionStoreEntry
GET  /api/sessions/:agentId/:sessionKey/transcript  -> transcript entries via SessionManager
```

Handlers delegate to `SessionRouter.listSessions()` and `SessionRouter.getStatus()`.

### Frontend session-store.ts evolution

| Current | New |
|---|---|
| `ChatSession` (id, agentName, llmSlug, messages) | Backed by `SessionStoreEntry` from server |
| `sessions: Record<string, ChatSession>` keyed by sessionId | `sessions: Record<string, SessionStoreEntry>` keyed by sessionKey |
| `activeSessionId: Record<string, string>` (nodeId -> sessionId) | `activeSessionKey: Record<string, string>` (nodeId -> sessionKey) |
| `createSession(agentName, provider, modelId)` | Calls server -> `SessionRouter.route()` |
| `addMessage(sessionId, msg)` | Calls server -> message dispatched through SessionRouter |
| `loadSessionsFromDisk()` | `fetchSessions(agentId)` -> hits `GET /api/sessions/:agentId` |

### Frontend displays from SessionStoreEntry

- Token usage (inputTokens, outputTokens, contextTokens, totalEstimatedCostUsd)
- Compaction count
- Active model (providerOverride, modelOverride or agent defaults)
- Session age (createdAt, updatedAt)
- Chat type and display name

### ChatStore deprecation

`chat-store.ts` (simple localStorage cache keyed by agentId) becomes redundant. It is removed.

---

## Agent identity: agentId vs agentName

`AgentConfig` has both `id` (stable node UUID) and `name` (human-readable display name).

- **sessionKey** uses `agentId` (stable): `agent:<agentId>:main` -- survives renames
- **SessionStoreEntry.agentId** is the stable node id
- **Directory structure** continues to use `agentName` for human-readable paths: `<storagePath>/<agentName>/sessions/`
- **StorageEngine constructor** still takes `agentName` for directory resolution

If an agent is renamed, sessionKeys remain valid (they use the stable id). The directory may need renaming (out of scope for this pass -- existing behavior).

---

## Files touched

### New files
- `server/runtime/session-router.ts` -- SessionRouter class
- `server/runtime/session-router.test.ts` -- unit tests

### Modified files
- `shared/storage-types.ts` -- replace SessionMeta with SessionStoreEntry, extract snapshot/report types
- `shared/agent-config.ts` -- add reset fields to ResolvedStorageConfig
- `src/types/nodes.ts` -- add reset fields to StorageNodeData
- `src/utils/default-nodes.ts` -- add reset defaults
- `src/utils/graph-to-agent.ts` -- pass reset fields through to ResolvedStorageConfig
- `server/runtime/storage-engine.ts` -- rewrite: sessions.json map, drop JSONL methods
- `server/runtime/storage-engine.test.ts` -- update tests for new API
- `server/runtime/context-engine.ts` -- integrate SessionManager for compaction writes
- `server/runtime/agent-runtime.ts` -- receive SessionManager instance, wire to context engine
- `src/store/session-store.ts` -- rewrite: backed by SessionStoreEntry, server-first
- `src/panels/property-editors/StorageProperties.tsx` -- add Session Resets section
- `package.json` -- add @mariozechner/pi-coding-agent dependency
- Server routes -- add /api/sessions/ endpoints

### Removed files
- `src/store/chat-store.ts` -- replaced by session-store

### Docs to update
- `docs/concepts/storage-node.md` -- new schema, reset config, sessions.json format
- `docs/concepts/context-engine-node.md` -- compaction via SessionManager
