# Section 7A — Backend: REST API, WebSocket, Auth, Storage, Sessions

<!-- last-verified: 2026-05-08 -->

## Scope

Covers the backend control and persistence surface as wired in
`server/index.ts`:

- HTTP/REST routes registered directly in `server/index.ts` plus
  routers mounted from `server/routes/` (`subagents.ts`,
  `agent-channels.ts`).
- The single WebSocket endpoint (`/ws`) and its connection handler
  (`server/connections/ws-handler.ts`).
- Auth: `server/auth/api-keys.ts` (in-memory provider key store).
- Storage subsystem: `server/storage/storage-engine.ts`,
  `graph-file-store.ts`, `settings-file-store.ts`.
- Sessions subsystem: `server/sessions/session-router.ts`,
  `session-transcript-store.ts`. `session-tools.ts` is identified
  here but its tool runtime semantics belong to Section 7B.

Not covered here: tools/HITL/skills/CLI (7B), runtime turn loop (6A),
engines/hooks/comms internals (6B).

## REST API

### Route inventory

All routes live in `server/index.ts` unless the "Source" column says
otherwise. Bodies are JSON unless noted.

| Method | Path | Body / Query | Response | Frontend caller (verify) | Notes |
|--------|------|--------------|----------|--------------------------|-------|
| POST | `/api/agents/:agentId/resolved-system-prompt` | body: `{ config: AgentConfig, workspaceCwd? }` | `ResolvedSystemPrompt` | `SystemPromptPreview` panel (per index.ts:198) | Pure compute; agent need not be running. |
| POST | `/api/storage/init` | body: `{ config: ResolvedStorageConfig, agentName }` | `{ ok: true }` | storage bootstrap from `src/runtime/storage-client.ts` | Creates sessions dir (and memory dir if `memoryEnabled`). |
| DELETE | `/api/storage/agent-data` | body: `{ config, agentName }` | `{ ok: true }` | settings "wipe agent data" path | First destroys any running agent that owns the storage, then `rm -rf` of the agent dir. 50ms drain window for in-flight writes. |
| GET | `/api/sessions/:agentId` | query: `config`, `agentName` | `SessionStoreEntry[]` | session list panel | Filters out `channelMeta` sessions (see SessionRouter.listSessions). |
| POST | `/api/sessions/:agentId/route` | body: `{ config, agentName, request?: SessionRouteRequest }` | `RouteResult` | `useChatStream` open / new chat | Idempotently creates or returns a session, may auto-reset on daily/idle boundary, then seeds context breakdown. |
| POST | `/api/sessions/:agentId/:sessionKey/reset` | body: `{ config, agentName }` | `RouteResult` | "Reset session" UI | Forks parent transcript when `parentForkMaxTokens` policy permits. |
| DELETE | `/api/sessions/:agentId/:sessionKey/messages/:messageId` | body: `{ config, agentName }` | `{ deleted: boolean }` | message context menu | Deletes one transcript entry; bumps `updatedAt`. |
| POST | `/api/sessions/:agentId/:sessionKey/clear` | body: `{ config, agentName }` | `RouteResult` | "Clear messages" UI | Wipes transcript, zeroes token counters. |
| POST | `/api/sessions/:agentId/:sessionKey/compact` | (none) | `SessionCompactResponse` | "Compact" UI | 400 if agent not running. Uses `agentManager.manualCompact`. |
| GET | `/api/sessions/:agentId/:sessionKey/transcript` | query: `config`, `agentName` | `SessionTranscriptResponse` | transcript loader | 404 if session not in store. Reads JSONL via `SessionTranscriptStore.readTranscript`. |
| GET | `/api/sessions/:agentId/:sessionKey` | query: `config`, `agentName` | `SessionStoreEntry \| null` | status poll | Routes through SessionRouter (so agentId scoping enforced). |
| DELETE | `/api/sessions/:agentId/:sessionKey` | query: `config`, `agentName` | `{ ok: true }` | session delete | Calls `engine.deleteSession`. |
| DELETE | `/api/sessions/:agentId` | query: `config`, `agentName` | `{ ok, deleted }` | "delete all" UI | Deletes every session whose `agentId` matches via SessionRouter. |
| POST | `/api/storage/sessions/enforce-retention` | body: `{ config, agentName, maxSessions }` | `{ ok: true }` | retention policy enforcer | Trims oldest sessions beyond cap. |
| POST | `/api/storage/memory/daily` | body: `{ config, agentName, content, date? }` | `{ ok: true }` | memory engine | Appends to `memory/<YYYY-MM-DD>.md`. |
| GET | `/api/storage/memory/daily/:date` | query: `config`, `agentName` | `{ content }` | memory reader | `content` is `null` when missing. |
| GET | `/api/storage/memory/long-term` | query: `config`, `agentName` | `{ content }` | memory panel | Reads `memory/MEMORY.md`. |
| PUT | `/api/storage/memory/long-term` | body: `{ config, agentName, content }` | `{ ok: true }` | memory editor save | Full-file overwrite. |
| GET | `/api/storage/memory/files` | query: `config`, `agentName` | `MemoryFileInfo[]` | memory file picker | Tags daily vs evergreen using `^\d{4}-\d{2}-\d{2}\.md$`. |
| POST | `/api/browser/launch-chrome` | body: `{ port?, userDataDir? }` | launch result | Browser tool setup | Calls `launchChromeForCdp`. |
| POST | `/api/storage/maintenance` | body: `{ config, agentName }` | `MaintenanceReport` | settings storage panel | Mode taken from `config.maintenanceMode`. |
| POST | `/api/storage/maintenance/dry-run` | body: `{ config, agentName }` | `MaintenanceReport` | settings panel "Preview" | Forces `mode='warn'` (no deletion). |
| GET | `/api/sessions/:agentId/:sessionKey/branches` | query: `config`, `agentName` | `BranchTree` | branch picker | 404 when session missing. |
| GET | `/api/sessions/:agentId/:sessionKey/lineage` | query: `config`, `agentName` | `SessionLineage` | lineage breadcrumb | Walks `parentSessionId` via `engine.getSessionById`. |
| GET | `/api/settings` | (none) | `PersistedSettings` | `settings-store` boot fetch | |
| PUT | `/api/settings` | body: `PersistedSettings` | `{ ok: true }` | settings save | Side effects: refreshes `apiKeys.setAll(...)` and live `currentSafetySettings` (running agents are NOT rebuilt; new starts pick up). |
| GET | `/api/graph` | (none) | `PersistedGraph \| null` | `graph-store` boot fetch | `null` triggers client-side localStorage migration push. |
| PUT | `/api/graph` | body: `PersistedGraph` | `{ ok: true }` | graph save | Validates `graph.nodes` and `graph.edges` are arrays; 400 otherwise. |
| GET | `/api/providers` | (none) | provider summaries | `provider-loader` boot | `pluginRegistry.listSummaries()`. |
| GET | `/api/tools` | (none) | tool catalog | `tool-catalog-store` boot | Returns `[]` rather than 500 if registry not yet initialized (race-tolerant). |
| POST | `/api/providers/catalog/load` | body: `{ request, apiKeyFingerprint? }` | catalog | model picker open | Returns cached catalog or refreshes on cache miss. Returns empty payload (not 500) when plugin/catalog/api-key missing. |
| POST | `/api/providers/catalog/refresh` | body: `{ request }` | catalog | "Refresh models" button | 400 if no catalog or no API key. |
| POST | `/api/providers/catalog/clear` | body: `{ request? }` | `{ ok: true }` | "Clear cache" | Omitting `request` clears all. |
| GET | `/api/health` | (none) | `{ status: 'ok' }` | smoke test | |
| GET | `/api/agents/:agentId/channels` | (none) | per-peer channel rows | agent comms panel | Source: `routes/agent-channels.ts`. 404 if agent not running. |
| GET | `/api/agents/:agentId/channels/:channelKey/transcript` | query: `limit?` (1..500, default 50) | comm events | comms transcript | URL-decoded channel key. |
| POST | `/api/subagents/:subAgentId/kill` | (none) | `{ killed: true }` | sub-agents panel | 404 unknown / 409 not-running. Source: `routes/subagents.ts`. |
| GET | `/api/subagents/:subAgentId` | (none) | sub-agent record | sub-agents panel | |
| GET | `/api/subagents` | query: `parentSessionKey` | sub-agent records | sub-agents panel | 400 if `parentSessionKey` missing. |

### Notable error envelopes

- All ad-hoc handlers wrap in `try/catch` and respond `500 { error: <message> }`. There is no shared error middleware.
- `404 { error: '...' }` is used for missing session (transcript, branches, lineage), missing channel, missing sub-agent.
- `409 { error: 'not-running', reason: 'not-running', status }` from `/api/subagents/:id/kill`.
- `400 { error: '...' }` for invalid graph payload, invalid provider catalog request, missing `parentSessionKey`, and "agent not running" on compact.

### Per-route auth requirements

There is no per-route auth middleware. `server/auth/api-keys.ts`
defines an in-memory provider-key store; it is read by provider
routes (catalog/refresh, samAgent runtime) and is NOT a request
authentication mechanism. The backend assumes a trusted single-user
local context. Body limit: `express.json({ limit: '10mb' })`.

### Notable query-string usage (F-02 regression risk)

Many session endpoints take the entire `ResolvedStorageConfig` as a
JSON-encoded string in the query string:

- `GET /api/sessions/:agentId`
- `GET /api/sessions/:agentId/:sessionKey`
- `DELETE /api/sessions/:agentId/:sessionKey`
- `DELETE /api/sessions/:agentId`
- `GET /api/sessions/:agentId/:sessionKey/transcript`
- `GET /api/sessions/:agentId/:sessionKey/branches`
- `GET /api/sessions/:agentId/:sessionKey/lineage`
- `GET /api/storage/memory/daily/:date`
- `GET /api/storage/memory/long-term`
- `GET /api/storage/memory/files`

`ResolvedStorageConfig` carries `storagePath`, `maintenanceMode`,
`pruneAfterDays`, `maxEntries`, `rotateBytes`,
`resetArchiveRetentionDays`, `maxDiskBytes`, `highWaterPercent`,
`maintenanceIntervalMinutes`, `sessionRetention`, `dailyResetEnabled`,
`dailyResetHour`, `idleResetEnabled`, `idleResetMinutes`,
`parentForkMaxTokens`, `memoryEnabled`. JSON-encoded into a
querystring this routinely produces 1–2 KB URLs and risks hitting
proxy/header limits. **F-02**: storage config in query string is a
known smell flagged for regression coverage.

## WebSocket

### Connection URL

`ws://<host>:<STORAGE_PORT>/ws` (default port 3210; overridable via
`STORAGE_PORT` env var). Logged at startup as
`WebSocket available at ws://localhost:${PORT}/ws`.

### Upgrade path (server/index.ts:778-786)

```ts
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
wss.on('connection', (socket) => {
  handleConnection(socket, agentManager, apiKeys, samAgent, samAgentBroadcasters);
});
```

`ws` library `WebSocketServer` is attached to the same HTTP server,
filtered to path `/ws`. Startup error is shared (`handleStartupError`)
so an `EADDRINUSE` from either layer cleanly kills the process.

### Message envelope

JSON messages parsed from `data.toString()` in
`server/connections/ws-handler.ts:37`. Inbound `Command` types
(declared in `shared/protocol.ts`) include:

- `agent:start` — invokes `agentManager.start(config)`, then attaches the socket and emits `agent:ready`.
- `agent:dispatch` — routes to the same agent. Intercepts pending HITL prompts (kind=ask/confirm) and may reject with `agent:error` on parse error.
- (other commands continue beyond the 100 lines I read; verify before exhaustive doc).

Outbound envelopes broadcast through the per-agent bridge include
at minimum: `agent:ready`, `agent:error`, `run:accepted`,
`hitl:resolved`, plus runtime stream events. SAMAgent envelopes are
fan-out via `samAgentBroadcasters: Set<(envelope) => void>` shared at
the module scope, so each socket gets its own broadcaster registered
on `connection` and removed on `close`.

### Event types broadcast (sample, verify against shared/protocol.ts)

`agent:ready`, `agent:error`, `run:accepted`, `hitl:resolved`,
`samAgent:event`. Streaming run events flow through the per-agent
bridge attached when `agentManager.addSocket(...)` is called.

### F-01 status check

README claims WS streaming. `server/index.ts:778` confirms a real
`WebSocketServer` on `/ws`, and `ws-handler.ts` shows commands and
events flowing both directions. Section 4 noted `useChatStream` uses
`agentClient.onEvent` which goes over WS — that matches. **F-01:
WebSocket streaming is real, not aspirational.**

## Auth (server/auth/)

`server/auth/api-keys.ts` — `ApiKeyStore` is a 22-line in-memory
`Record<string, string>` keyed by provider id with `setAll`, `get`,
`has`. It is **not** request auth; it is a cache of LLM provider
keys consumed by provider catalog/refresh routes and by AgentRuntime
when assembling outbound provider auth. The store is seeded from
`settings.json` on boot (`settingsFile.load()` in index.ts:789-802)
and refreshed in-place by `PUT /api/settings`. Keys are NOT persisted
back from this store on its own — persistence is owned by
`SettingsFileStore`.

There is no per-route bearer/cookie/session auth; the backend
assumes a trusted local single-user context.

## Storage Subsystem

### Storage Engine (server/storage/storage-engine.ts)

**Backend types**: filesystem only. There is one implementation
class `StorageEngine`. (Vector-database / cloud backends advertised
elsewhere in the schema are not implemented here — verify before
documenting.)

**File layout on disk (relative to `config.storagePath`, with `~` expanded to `os.homedir()`)**:

```
<storagePath>/<agentName>/
  sessions/
    sessions.json                  # SessionStoreEntry map (canonical metadata)
    sessions.<timestamp>.json.bak  # rotated metadata (post rotateBytes)
    <sessionId>.jsonl              # transcript per session (header + entries)
    <sessionId>.reset.<...>.jsonl  # archived after reset (cleaned per resetArchiveRetentionDays)
  memory/                          # only when config.memoryEnabled
    YYYY-MM-DD.md                  # daily memory (matched against /^\d{4}-\d{2}-\d{2}\.md$/)
    MEMORY.md                      # long-term/evergreen
    *.md                           # any other evergreen file
```

`_safeJoin()` enforces base-prefix containment to block `..`
traversal in agent-supplied path components.

**maintenanceMode**: `'warn' | 'enforce'`. `runMaintenance(mode?)`
takes the explicit mode argument or falls back to
`config.maintenanceMode`. `'warn'` is a dry-run; `'enforce'` mutates
disk.

**Knobs (all fields of `ResolvedStorageConfig`)**:

- `pruneAfterDays` — entries with `updatedAt < (now - days)` (lexical ISO compare) are pruned.
- `maxEntries` — when `> 0` and after-prune session count exceeds, oldest are deleted.
- `rotateBytes` — when `sessions.json` grows past, it is renamed to `sessions.<ts>.json.bak` and replaced with `{}`. Returns `storeRotated: true` in the report.
- `resetArchiveRetentionDays` — files matching `*.reset.*` older than this by `mtime` are unlinked.
- `maxDiskBytes` — hard cap on `sessions/` directory total size (sum of file sizes).
- `highWaterPercent` — when usage > `maxDiskBytes * highWaterPercent / 100`, oldest sessions are evicted by `updatedAt` until under high-water.
- `maintenanceIntervalMinutes` — background cadence (consumed elsewhere; index.ts only mounts on-demand routes for maintenance).

**Rotation behavior**: only `sessions.json` rotates (`rotateStoreFile`). Transcripts do not auto-rotate; they are removed by orphan cleanup, retention, or budget eviction.

**Maintenance reports** (`MaintenanceReport`, surfaced to UI):

```ts
{ mode, prunedEntries, orphanTranscripts, archivedResets,
  storeRotated, diskBefore, diskAfter, evictedForBudget }
```

The orphan pass cross-references `sessions.json` against
`*.jsonl` files in `sessions/`; budget enforcement runs after orphan
cleanup so reclaim-by-orphan happens first.

**N+1 / chunked I/O**: orphan and reset-archive cleanup process files
in chunks of 50 with `Promise.all` to bound FD pressure. `getDiskUsage`
fans `fs.stat` out concurrently across all session files.

### Graph File Store (server/storage/graph-file-store.ts)

- Path: `<cwd>/graph.json` (single canvas blob).
- Schema: `{ id, version, graph: { nodes, edges }, updatedAt }`.
- `load()` returns `null` on `ENOENT` so the client can detect "server empty → push localStorage cached graph up".
- `save()` is *not* atomic (no temp + rename). Direct `fs.writeFile` — concurrent saves or crash mid-write can leave an empty/partial file. **Note for regression coverage.**

### Settings File Store (server/storage/settings-file-store.ts)

- Path: `<cwd>/settings.json`.
- Schema (`PersistedSettings`): `apiKeys: Record<string,string>`, `agentDefaults`, `storageDefaults`, `safety: SafetySettings` (with `allowDisableHitl` and `confirmationPolicy`).
- Default `confirmationPolicy` is the long Markdown block defined inline in `settings-file-store.ts`. `LEGACY_CONFIRMATION_POLICIES` lets users on older defaults auto-upgrade without losing custom edits.
- `save()` is also a plain (non-atomic) `fs.writeFile`.
- **Server-side vs browser localStorage**: only the four keys above persist via this store. Section 3 noted that many UI/workspace settings (theme, panel widths, etc.) live exclusively in browser localStorage. Verify against `src/settings/` before claiming any specific setting is server-persisted.

## Sessions Subsystem

### Session Router (server/sessions/session-router.ts)

**sessionKey shapes** (`buildSessionKey`):

- `cron:<cronJobId>` (when `cronJobId` set)
- `hook:<webhookId>` (when `webhookId` set)
- `agent:<agentId>:<subKey ?? 'main'>` (default direct chat)

Sub-agent keys (`sub:*` or wrapped `agent:<id>:sub:*`) and channel
keys (`channel:<lo>:<hi>`) are produced elsewhere — see
`shared/sub-agent-types.ts` and `shared/agent-comm-types.ts`.

**Routing strategy**: `route(req)` hashes the request to a
sessionKey, returns the existing entry, or creates one (and enforces
`sessionRetention` on creation). On match it may auto-reset when
`shouldReset` returns true:

- `dailyResetEnabled` and the last `updatedAt` is before today's `dailyResetHour` boundary.
- `idleResetEnabled` and now-`updatedAt` exceeds `idleResetMinutes`.

`resetSession` may fork from the parent transcript when
`storageConfig.parentForkMaxTokens > 0` and
`existing.totalTokens <= parentForkMaxTokens` (cheap, low-context
sessions get a parent-prefixed transcript; expensive ones start
fresh). Counters are zeroed on reset; `parentSessionId` chains the
ancestry walked by `/api/sessions/:agentId/:sessionKey/lineage`.

**Isolation rules**: `getStatus` and `listSessions` filter so the
caller only sees sessions whose `agentId === this.agentId`.
`listSessions` additionally hides any entry with `channelMeta`
(channel sessions are not user-facing chats). The router stores
`sessionFile` as a **relative** path under `agentDir`, joining it
back via `_safeJoin` on read — so moving `storagePath` keeps
transcripts addressable.

**Storage backend selection per request**: there is no per-request
backend negotiation today. The (engine, transcriptStore, router)
triple is keyed by `${storagePath}:${agentName}[:${agentId}]` in
`engines` / `transcriptStores` / `sessionRouters` maps in
`server/index.ts`. A new instance is constructed lazily on first
request and reused.

### Session Transcript Store (server/sessions/session-transcript-store.ts)

- Format on disk: JSONL — line 1 is the `SessionHeader`, subsequent lines are `SessionEntry`. Provided by `@mariozechner/pi-coding-agent`'s `SessionManager`.
- Mutations route through `writeSnapshot(sessionFile, header, entries)` which **rewrites the entire file** as `header + entries` joined by `\n`. There is no append-only fast path here for full rewrites (clear/delete-entry/snapshot all overwrite). Per-turn streaming appends happen through `SessionManager` (used by `AgentRuntime`, see Section 6A) — not via this store.
- Branching: `buildBranchTree(sessionFile)` walks `parentId` adjacency to surface fork points and a default-path traversal (latest child at each fork). `BranchTree` shape lives in `shared/storage-types.ts`.
- Retention interaction: there is no direct retention here — the engine deletes the file via `deleteTranscriptFile` when `engine.deleteSession(sessionKey)` runs. `clearTranscript` keeps the file but writes an empty entries list.
- F-02 connection: every transcript read goes through a route whose `config` arrives via query string (see "Notable query-string usage" above).

### Session Tools (server/sessions/session-tools.ts)

This file *defines* session-bound agent tools. Listed in
`shared/resolve-tool-names.ts` as `SESSION_TOOL_NAMES`:

- `sessions_list`
- `sessions_history`
- `sessions_send`
- `sessions_spawn`
- `sessions_yield`
- `subagents`
- `session_status`

These names appear in the `IMPLEMENTED_TOOL_NAMES` set so the system
prompt advertises them. Runtime semantics (yielding, listing
history, spawning sub-agents, killing them) belong to **Section 7B
— Tools / HITL / Skills / CLI**, since `SessionToolContext` wires
into `RunCoordinator`, `SubAgentRegistry`, and `SubAgentExecutor`.

## End-to-End Test Scenarios

### TC7A.1 — `GET /api/health` returns 200 `{ status: 'ok' }`

Steps: hit `/api/health` immediately after server start. Asserts
HTTP 200 and exact body. Smoke test for sandbox/CI.

### TC7A.2 — `POST /api/providers/catalog/refresh` syncs from upstream

Pre: API key for the plugin is set via `PUT /api/settings`. POST
`{ request: { pluginId, authMethodId?, envVar?, baseUrl? } }`. Expect
catalog payload populated. Without API key: 400.

### TC7A.3 — `POST /api/sessions/{agentId}/route` starts a session

POST with `config`/`agentName`/`request`. First call: `created:true`.
Repeat call (no idle/daily boundary crossed): `created:false`,
`reset:false`, same `sessionKey`/`sessionId`.

### TC7A.4 — `GET /api/sessions/{agentId}/{sessionKey}/transcript` returns JSONL entries

Pre: session created via TC7A.3 and at least one turn dispatched via
WS so transcript has entries. Expect `SessionTranscriptResponse`
with `entries[]` matching `SessionEntry` shape. 404 for unknown
sessionKey.

### TC7A.5 — Long URL: storage config bloats query string (F-02 regression)

Build a `ResolvedStorageConfig` with realistic-but-long
`storagePath` (e.g. nested user dir on Windows). Hit
`GET /api/sessions/{agentId}` and confirm URL length and that the
response succeeds. Asserts that current behavior works AND captures
the URL length as a regression smell. **Failure budget**: anything
that raises typical URL > 2 KB.

### TC7A.6 — WS connection establishes and run events broadcast

Connect to `ws://localhost:3210/ws`. Send `agent:start`. Expect
`agent:ready`. Send `agent:dispatch` with a session key. Expect
streamed run events ending in a turn-complete envelope. (Exact
envelope types: see `shared/protocol.ts` — verify before asserting.)

### TC7A.7 — WS reconnect resumes run progress

Open WS, dispatch a long-running turn, drop the socket mid-turn,
reconnect, re-call `addSocket` via the dispatch path, verify that
buffered events for the still-running run are delivered (or, if the
bridge does not buffer, document the gap as a finding).

### TC7A.8 — Storage maintenance "warn" mode emits report, no deletion

POST `/api/storage/maintenance/dry-run` with a config where
`pruneAfterDays=1` and there is at least one session updated 2 days
ago. Expect `mode='warn'`, `prunedEntries` listing the stale
sessionKey, but assert the file is still present after.

### TC7A.9 — Storage maintenance "prune" mode actually deletes per `pruneAfterDays`

Same setup as TC7A.8, but POST `/api/storage/maintenance` with
`maintenanceMode='enforce'`. After call: stale sessionKey is gone
from `sessions.json` and the corresponding `.jsonl` is unlinked.

### TC7A.10 — Rotation: `sessions.json` > `rotateBytes` spawns rotated `.bak`

Seed `sessions.json` to be larger than `config.rotateBytes`. Run
maintenance in enforce mode. Assert `storeRotated:true` in report,
`sessions.<timestamp>.json.bak` exists, and current `sessions.json`
is `{}`.

### TC7A.11 — Disk high-water (`highWaterPercent`) triggers eviction

Create N transcripts large enough that disk usage exceeds
`maxDiskBytes`. Run maintenance. Assert `evictedForBudget` is non-empty,
oldest sessions evicted first (by `updatedAt`), and `diskAfter` is
under `maxDiskBytes * highWaterPercent / 100`.

### TC7A.12 — Backend independence: control endpoints work without frontend

(Per memory note `feedback_backend_frontend_independence`.) From a
clean start with no browser ever connected: `curl` `/api/health`,
`/api/graph`, `/api/settings`, `/api/sessions/{agentId}/route`.
Expect all to succeed. Confirms control-plane is REST-driven, not
WS-driven.

### TC7A.13 — Settings save error is swallowed silently

Make `settings.json` directory unwritable. PUT `/api/settings`.
Verify the route returns `500 { error }` (so server signals failure
correctly); cross-link to Section 3 finding that the **client**
ignores this status. Asserting both halves keeps the regression
visible.

### TC7A.14 — `DELETE /api/storage/agent-data` tears down running agent first

Start an agent. Issue DELETE. Verify (a) `agentManager.destroy` was
called for any agents using the storage path, (b) the 50ms drain
window elapsed, (c) `agentDir` is removed, (d) the engine cache for
that key is purged so a follow-up `init` works against a clean dir.

### TC7A.15 — Daily reset auto-rotates session on next route call

`config.dailyResetEnabled=true`, `dailyResetHour=4`. Create session
yesterday at 5am. Today at 5am call `route` again. Expect
`reset:true`, new `sessionId`, `parentSessionId === previous.sessionId`,
counters zeroed.

### TC7A.16 — Idle reset triggers after `idleResetMinutes`

`config.idleResetEnabled=true`, `idleResetMinutes=15`. Backdate
`updatedAt` 20 minutes. Call `route`. Expect `reset:true`.

### TC7A.17 — `parentForkMaxTokens` controls fork-vs-fresh on reset

Set `parentForkMaxTokens=10000`. Reset session with
`totalTokens=5000` → assert new transcript has parent prefix. Reset
session with `totalTokens=15000` → assert new transcript starts
empty. Confirms `shouldForkFromParent` semantics.

### TC7A.18 — Branches endpoint reflects fork tree

Create a session, add messages, branch via `deleteEntry` + new
dispatch (or seeded transcript with `parentId` adjacency), call
`GET .../branches`. Assert `forkPoints[].branches[].entryCount`
matches walked path lengths and `defaultPath` follows the latest
child.

### TC7A.19 — Sub-agent kill REST surface

POST `/api/subagents/{id}/kill` for a running sub-agent. Expect 200
`{killed:true}` and that the registry record transitions to killed.
Repeat → 409 `not-running`. Unknown id → 404.

### TC7A.20 — Agent channels list reflects only running peers

Start two agents with reciprocal `agentComm` direct channels. GET
`/api/agents/{id}/channels`. Expect both channels listed with
canonical channelKey, turn counts initially 0, `sealed:false`. Stop
one agent. Repeat. Expect 404 for the stopped agent.

### TC7A.21 — `GET /api/graph` returns `null` before any save

Fresh repo, no `graph.json`. Assert response body is exactly
`null`. PUT a valid graph. GET again, assert echo. PUT an invalid
graph (no `nodes`) → 400.

### TC7A.22 — Settings safety policy migrates legacy default

Seed `settings.json` with `safety.confirmationPolicy` matching one
of `LEGACY_CONFIRMATION_POLICIES`. GET `/api/settings`. Assert the
returned `confirmationPolicy` equals current
`DEFAULT_SAFETY_SETTINGS.confirmationPolicy`. Repeat with a
hand-edited policy and assert it is preserved verbatim.
