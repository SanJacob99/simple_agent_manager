# Session Deferred Features Design

**Date:** 2026-04-07
**Scope:** Session tools (7 tools), cron/webhook sessions, maintenance controls, tree navigation UI
**Depends on:** Session management foundation (2026-04-07-session-management-design.md) — already implemented

## Overview

This spec covers the four subsystems deferred from the initial session management implementation:

1. **Maintenance controls** — disk budget enforcement, stale entry pruning, store rotation, background scheduling
2. **Session tools** — 7 agent tools for cross-session inspection, messaging, and sub-agent orchestration
3. **Cron node & webhook routes** — scheduled and event-driven agent execution
4. **Tree navigation UI** — timeline with branch indicators, branch switching, session lineage

### Architecture Layers

```
Layer 1: Maintenance controls (foundation — disk/store health)
Layer 2: Session tools (depends on L1 for cleanup; uses SessionRouter + RunCoordinator)
Layer 3: Cron node + webhooks (depends on L2 for session tools; adds trigger infrastructure)
Layer 4: Tree navigation UI (independent; reads transcript tree structure)
```

---

## 1. Maintenance Controls

### 1.1 New StorageNodeData Fields

```typescript
// src/types/nodes.ts — StorageNodeData additions

// Maintenance config
maintenanceMode: 'warn' | 'enforce';         // default: 'warn'
pruneAfterDays: number;                       // default: 30
maxEntries: number;                           // default: 500
rotateBytes: number;                          // default: 10_485_760 (10MB)
resetArchiveRetentionDays: number;            // default: 30 (same as pruneAfterDays; 0 = no cleanup)
maxDiskBytes: number;                         // default: 0 (disabled)
highWaterPercent: number;                     // default: 80 (% of maxDiskBytes)
maintenanceIntervalMinutes: number;           // default: 60
```

### 1.2 ResolvedStorageConfig Additions

```typescript
// shared/agent-config.ts — ResolvedStorageConfig additions

maintenanceMode: 'warn' | 'enforce';
pruneAfterDays: number;
maxEntries: number;
rotateBytes: number;
resetArchiveRetentionDays: number;
maxDiskBytes: number;
highWaterPercent: number;
maintenanceIntervalMinutes: number;
```

### 1.3 StorageEngine New Methods

```typescript
// server/runtime/storage-engine.ts — new methods

interface MaintenanceReport {
  mode: 'warn' | 'enforce';
  prunedEntries: string[];           // sessionKeys removed due to staleness
  orphanTranscripts: string[];       // .jsonl files removed (not referenced)
  archivedResets: string[];          // *.reset.* files cleaned
  storeRotated: boolean;             // true if sessions.json was rotated
  diskBefore: number;                // bytes before cleanup
  diskAfter: number;                 // bytes after cleanup (same as before in warn mode)
  evictedForBudget: string[];        // sessionKeys evicted to meet disk budget
}

async runMaintenance(mode?: 'warn' | 'enforce'): Promise<MaintenanceReport>;
async getDiskUsage(): Promise<number>;
async pruneStaleEntries(pruneAfterDays: number, dryRun: boolean): Promise<string[]>;
async removeOrphanTranscripts(dryRun: boolean): Promise<string[]>;
async cleanResetArchives(retentionDays: number, dryRun: boolean): Promise<string[]>;
async rotateStoreFile(maxBytes: number, dryRun: boolean): Promise<boolean>;
async enforceDiskBudget(maxBytes: number, highWaterBytes: number, dryRun: boolean): Promise<string[]>;
```

### 1.4 Maintenance Pipeline

`runMaintenance()` executes in this order:

1. `pruneStaleEntries()` — remove entries where `updatedAt` is older than `pruneAfterDays`
2. `removeOrphanTranscripts()` — delete `.jsonl` files in sessions dir not referenced by any entry
3. `cleanResetArchives()` — delete `*.reset.*` transcript archives older than `resetArchiveRetentionDays`
4. Enforce `maxEntries` — if entry count exceeds cap, remove oldest by `updatedAt`
5. `rotateStoreFile()` — if `sessions.json` exceeds `rotateBytes`, archive to `sessions.<timestamp>.json.bak` and write fresh
6. `enforceDiskBudget()` — if `maxDiskBytes > 0` and usage exceeds it:
   - Remove oldest archived/orphan transcript files first
   - If still above `highWaterBytes` (= `maxDiskBytes * highWaterPercent / 100`), evict oldest session entries + their transcripts
   - Continue until at or below `highWaterBytes`

In `warn` mode: all steps run but return what *would* be cleaned without mutating. In `enforce` mode: mutations happen.

### 1.5 MaintenanceScheduler

```typescript
// server/runtime/maintenance-scheduler.ts

export class MaintenanceScheduler {
  constructor(
    private storageEngine: StorageEngine,
    private config: ResolvedStorageConfig,
  ) {}

  start(): void;        // starts interval timer
  stop(): void;         // clears interval
  runNow(): Promise<MaintenanceReport>;  // on-demand trigger
}
```

Starts on server boot with `maintenanceIntervalMinutes` interval. Also runs once at startup.

### 1.6 REST Endpoints

```
POST /api/storage/maintenance          -> MaintenanceReport (on-demand, uses configured mode)
POST /api/storage/maintenance/dry-run  -> MaintenanceReport (always warn mode)
```

### 1.7 UI

`StorageProperties.tsx` gains a "Maintenance" section with all config fields. `DataMaintenanceSection.tsx` gains a "Run Maintenance" button that calls the on-demand endpoint and displays the report.

---

## 2. Session Tools

### 2.1 Tool List

| Tool | Description | Requires |
|------|-------------|----------|
| `sessions_list` | List sessions with optional filters | Storage node |
| `sessions_history` | Read transcript of a specific session | Storage node |
| `sessions_send` | Send message to another session, optionally wait | Storage node |
| `sessions_spawn` | Spawn an isolated sub-agent session | Storage node + `subAgentSpawning: true` |
| `sessions_yield` | End turn, wait for sub-agent results | Storage node + `subAgentSpawning: true` |
| `subagents` | List, inspect, or kill spawned sub-agents | Storage node + `subAgentSpawning: true` |
| `session_status` | Show session status, optionally set model override | Storage node |

### 2.2 Tool Context

Tools need access to runtime infrastructure. A `SessionToolContext` is injected by `RunCoordinator` when building tools for a run:

```typescript
// server/runtime/session-tools.ts

export interface SessionToolContext {
  callerSessionKey: string;
  callerAgentId: string;
  callerRunId: string;
  sessionRouter: SessionRouter;
  storageEngine: StorageEngine;
  transcriptStore: SessionTranscriptStore;
  coordinator: RunCoordinator;
  subAgentRegistry: SubAgentRegistry;
  coordinatorLookup: (agentId: string) => RunCoordinator | null;  // for cross-agent spawning
}
```

### 2.3 Tool Definitions

#### sessions_list

```typescript
parameters: {
  kind: Optional<'all' | 'agent' | 'cron'>  // default: 'all'
  recency: Optional<number>                   // minutes; only sessions active within this window
}
```

Returns: array of `{ sessionKey, agentId, chatType, displayName, updatedAt, totalTokens, compactionCount }`.

#### sessions_history

```typescript
parameters: {
  sessionKey: string
  limit: Optional<number>    // default: 50
  before: Optional<string>   // entry id; paginate backwards
}
```

Returns: formatted transcript entries (role, text content, timestamp). Truncates tool results to save context.

#### sessions_send

```typescript
parameters: {
  sessionKey: string
  message: string
  wait: Optional<boolean>      // default: false
  timeoutMs: Optional<number>  // default: 60000
}
```

Dispatches via `coordinator.dispatch()` (or `coordinatorLookup(agentId).dispatch()` for cross-agent targets). If `wait: true`, calls `coordinator.wait(runId, timeoutMs)` and returns the agent's response text.

#### sessions_spawn

```typescript
parameters: {
  prompt: string
  targetAgentId: Optional<string>   // default: same agent
  wait: Optional<boolean>           // default: false
  timeoutMs: Optional<number>       // default: 60000
}
```

1. Creates a sub-agent session key: `sub:<callerSessionKey>:<uuid>`
2. Resolves target coordinator (same agent or `coordinatorLookup(targetAgentId)`)
3. Registers spawn in `SubAgentRegistry`
4. Dispatches prompt to the sub-agent session
5. If `wait: true`, blocks until sub-agent completes and returns result
6. Returns `{ subAgentId, sessionKey, runId }`

#### sessions_yield

```typescript
parameters: {
  message: Optional<string>   // final message before yielding
}
```

Signals the runtime to end the current turn cleanly. Sets a `yieldPending` flag on the `SubAgentRegistry` for the caller session. When all active sub-agents complete, the registry dispatches a follow-up message to the parent containing sub-agent results, triggering a new turn.

If no sub-agents are active, `sessions_yield` is a no-op (turn ends normally).

**Streaming interaction:** When `sessions_yield` is called, the runtime ends the current agent turn cleanly. The `message` parameter (if provided) becomes the final assistant text in the response stream. The turn completes normally from the client's perspective — the follow-up dispatch (when sub-agents complete) starts a new turn.

#### subagents

```typescript
parameters: {
  action: 'list' | 'status' | 'kill'
  subAgentId: Optional<string>   // required for 'status' and 'kill'
}
```

- `list`: returns all sub-agents spawned by the caller session `[{ subAgentId, sessionKey, status, startedAt }]`
- `status`: returns detailed status for one sub-agent including run result if completed
- `kill`: aborts the sub-agent's run via `coordinator.abort(runId)`

#### session_status

```typescript
parameters: {
  sessionKey: Optional<string>    // default: caller's session
  modelOverride: Optional<string> // if set, updates the session's model override
}
```

Returns: `{ sessionKey, sessionId, agentId, chatType, createdAt, updatedAt, inputTokens, outputTokens, contextTokens, totalEstimatedCostUsd, compactionCount, modelOverride, providerOverride }`.

If `modelOverride` is provided, calls `sessionRouter.updateAfterTurn(sessionKey, { modelOverride })`.

### 2.4 SubAgentRegistry

```typescript
// server/runtime/sub-agent-registry.ts

interface SubAgentRecord {
  subAgentId: string;           // UUID
  parentSessionKey: string;
  parentRunId: string;
  targetAgentId: string;
  sessionKey: string;           // sub:<parent>:<uuid>
  runId: string;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  endedAt?: number;
  result?: string;              // final assistant text
  error?: string;
}

export class SubAgentRegistry {
  spawn(parent: { sessionKey: string; runId: string }, target: { agentId: string; sessionKey: string; runId: string }): SubAgentRecord;
  onComplete(runId: string, result: string): void;
  onError(runId: string, error: string): void;
  listForParent(parentSessionKey: string): SubAgentRecord[];
  get(subAgentId: string): SubAgentRecord | null;
  kill(subAgentId: string): boolean;

  // Yield support
  setYieldPending(parentSessionKey: string): void;
  isYieldPending(parentSessionKey: string): boolean;
  clearYieldPending(parentSessionKey: string): void;
}
```

On sub-agent completion, if `isYieldPending(parentSessionKey)`, the registry:
1. Checks if all sub-agents for that parent are complete
2. If yes: dispatches a follow-up message to the parent's coordinator with aggregated results
3. Clears the yield flag

### 2.5 Tool Registration

`ALL_TOOL_NAMES` gains the 7 session tool names. `tool-factory.ts` gains:

```typescript
export function createSessionTools(context: SessionToolContext): AgentTool<TSchema>[];
```

`RunCoordinator` calls this when building tools for a run, only if storage is available. Spawn/yield/subagents tools are excluded if `subAgentSpawning` is false.

### 2.6 Integration with RunCoordinator

- `RunCoordinator` constructor gains an optional `SubAgentRegistry` parameter (or creates one)
- On run completion, `RunCoordinator` notifies `SubAgentRegistry.onComplete()` if the run's sessionKey matches a sub-agent pattern
- `executeRun()` injects session tools into the agent's tool set via `createSessionTools()`

---

## 3. Cron Node & Webhook Routes

### 3.1 CronNodeData

```typescript
// src/types/nodes.ts — new node type

export interface CronNodeData {
  [key: string]: unknown;
  type: 'cron';
  label: string;
  schedule: string;                              // cron expression, e.g. "0 9 * * *"
  prompt: string;                                // message template sent each run
  enabled: boolean;                              // default: true
  sessionMode: 'persistent' | 'ephemeral';       // default: 'persistent'
  timezone: string;                              // default: 'local'
  maxRunDurationMs: number;                       // default: 300000 (5 min)
  retentionDays: number;                          // default: 7 (ephemeral mode only)
}
```

### 3.2 Defaults

```typescript
// src/utils/default-nodes.ts — cron case

label: 'Cron Job',
schedule: '0 9 * * *',
prompt: '',
enabled: true,
sessionMode: 'persistent',
timezone: 'local',
maxRunDurationMs: 300000,
retentionDays: 7,
```

### 3.3 ResolvedCronConfig

```typescript
// shared/agent-config.ts — new config interface

export interface ResolvedCronConfig {
  cronNodeId: string;        // stable node id for session key derivation
  label: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  sessionMode: 'persistent' | 'ephemeral';
  timezone: string;
  maxRunDurationMs: number;
  retentionDays: number;
}
```

`AgentConfig` gains:
```typescript
crons: ResolvedCronConfig[];   // array — one agent can have multiple cron nodes
```

### 3.4 Connection Rules

- CronNode connects to an AgentNode (peripheral, like storage/tools/etc.)
- One agent can have multiple CronNodes
- CronNode cannot connect to other peripherals

### 3.5 Session Key Routing

Session keys for cron: `cron:<cronNodeId>`

`SessionRouter.buildSessionKey()` is extended. When the `RouteRequest` includes `cronJobId`, the key is `cron:<cronJobId>` instead of the standard `agent:<id>:<subKey>` pattern.

```typescript
// RouteRequest gains:
cronJobId?: string;    // if set, key = cron:<cronJobId>
webhookId?: string;    // if set, key = hook:<webhookId>
```

For ephemeral session mode: `SessionRouter` checks the cron config and always creates a new sessionId on each route, regardless of reset checks.

### 3.6 CronScheduler

```typescript
// server/runtime/cron-scheduler.ts

import cron from 'node-cron';

export class CronScheduler {
  constructor(
    private coordinatorLookup: (agentId: string) => RunCoordinator | null,
  ) {}

  reconcile(agentId: string, crons: ResolvedCronConfig[]): void;
  // ^ Compares running jobs with config. Starts new, stops removed, restarts changed.

  stopAll(): void;
  listJobs(): CronJobStatus[];
}

interface CronJobStatus {
  cronNodeId: string;
  agentId: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  status: 'scheduled' | 'running' | 'stopped';
}
```

On each tick:
1. Look up the agent's `RunCoordinator` via `coordinatorLookup`
2. Call `coordinator.dispatch({ sessionKey: cron:<cronNodeId>, text: prompt })`
3. If `maxRunDurationMs` is set, start a timeout that aborts the run

### 3.7 Graph Save Integration

When the graph is saved and agent configs are rebuilt, the server calls `cronScheduler.reconcile(agentId, config.crons)` to sync running jobs with the new config.

### 3.8 Ephemeral Session Cleanup

For ephemeral cron sessions: after a run completes, old transcripts beyond `retentionDays` are cleaned by the maintenance scheduler (which already handles stale entries). The cron session entry's `updatedAt` is set to the run completion time, so `pruneAfterDays` naturally handles cleanup if `retentionDays >= pruneAfterDays`. For shorter retention, the `CronScheduler` runs its own cleanup after each tick.

### 3.9 Webhook Routes

Webhooks are configured at the server level, not as graph nodes.

**Configuration:**

```typescript
// server/config.ts or server/webhooks.ts

export interface WebhookConfig {
  id: string;
  path: string;               // e.g. "/my-hook"
  agentId: string;
  secret?: string;             // HMAC-SHA256 validation
  sessionKeyOverride?: string; // default: "hook:<id>"
}
```

Loaded from a `webhooks.json` file in the server data directory, or from environment/startup config.

**Server registration:**

```typescript
// server/runtime/webhook-handler.ts

export class WebhookHandler {
  constructor(
    private webhooks: WebhookConfig[],
    private coordinatorLookup: (agentId: string) => RunCoordinator | null,
  ) {}

  registerRoutes(app: Express): void;
  // Registers POST /api/webhook/:path for each configured webhook
}
```

Each webhook route:
1. Validates HMAC signature if `secret` is configured (using `X-Webhook-Signature` header)
2. Extracts message from `req.body.message` or `req.body.text` (or stringifies the entire body)
3. Resolves session key: `sessionKeyOverride ?? "hook:<id>"`
4. Dispatches to the target agent's `RunCoordinator`
5. Returns `202 Accepted` with `{ runId, sessionKey }`

### 3.10 UI Components

**CronNode.tsx** — canvas node showing schedule expression, enabled badge, and session mode indicator.

**CronProperties.tsx** — property editor with:
- Schedule expression input with human-readable preview (e.g., "Every day at 9:00 AM")
- Prompt template textarea
- Enabled toggle
- Session mode: persistent / ephemeral radio
- Timezone selector
- Max run duration slider
- Retention days (shown only in ephemeral mode)

### 3.11 New Dependencies

```json
"node-cron": "^3.0.3"
```

---

## 4. Tree Navigation UI

### 4.1 SessionStoreEntry Addition

```typescript
// shared/storage-types.ts — SessionStoreEntry addition

parentSessionId?: string;   // set when session is forked (daily/idle reset with parent fork)
```

`SessionRouter.resetSession()` sets `parentSessionId` to the old `sessionId` when forking.

### 4.2 Branch Tree Data Model

```typescript
// shared/storage-types.ts — new types

export interface ForkPoint {
  entryId: string;           // the entry where the fork occurs
  timestamp: string;
  branches: BranchInfo[];
}

export interface BranchInfo {
  branchId: string;          // first entry id on this branch
  label: string;             // auto-generated or from branch_summary
  preview: string;           // first message text on branch (truncated)
  timestamp: string;
  entryCount: number;
}

export interface BranchTree {
  forkPoints: ForkPoint[];
  defaultPath: string[];     // entry ids forming the latest branch path
  totalEntries: number;
}

export interface SessionLineage {
  current: { sessionId: string; sessionKey: string; createdAt: string };
  ancestors: Array<{ sessionId: string; sessionKey: string; createdAt: string }>;
}
```

### 4.3 Server Endpoints

```
GET /api/sessions/:agentId/:sessionKey/branches -> BranchTree
GET /api/sessions/:agentId/:sessionKey/lineage  -> SessionLineage
```

**`/branches`**: `SessionTranscriptStore` reads the JSONL, builds an adjacency list from `id`/`parentId`, identifies fork points (entries with >1 child), and constructs `BranchTree`. The `defaultPath` follows the latest child at each fork (by timestamp).

**`/lineage`**: Walks `parentSessionId` links in `sessions.json` to build the ancestor chain.

### 4.4 Frontend Store Changes

```typescript
// src/store/session-store.ts — additions

activeBranch: Record<string, string[]>;  // sessionKey -> selected branch path (entry ids)

// New actions
fetchBranchTree(agentId: string, sessionKey: string): Promise<BranchTree>;
selectBranch(sessionKey: string, branchPath: string[]): void;
fetchLineage(agentId: string, sessionKey: string): Promise<SessionLineage>;
```

### 4.5 UI Components

#### BranchIndicator

Rendered inline in the message timeline at fork points.

- Small branch icon (git-branch style) with branch count badge
- Clickable — opens `BranchSwitcher` popover
- Visually distinct from message bubbles (muted color, small)

#### BranchSwitcher

Popover anchored to a `BranchIndicator`.

- Lists branches at this fork point
- Each branch shows: label, preview text, timestamp, entry count
- Active branch is highlighted
- Clicking a branch calls `selectBranch()` and re-renders the timeline following that path

#### SessionLineageBar

Rendered above the chat message area when `parentSessionId` is set.

- Breadcrumb trail: `← Parent (Apr 6) → Current`
- Clicking parent loads that session's transcript in read-only mode
- Clicking "Current" returns to the active session

### 4.6 Message Filtering

When the user selects a branch, messages are filtered to show only entries on the selected path. The `useChatStream` hook (or equivalent) applies the `activeBranch` filter:

1. Start from the root entry
2. At each fork point, follow the selected branch
3. Render only entries on the chosen path

If no branch is selected, follow the `defaultPath` from `BranchTree`.

### 4.7 StorageClient Additions

```typescript
// src/runtime/storage-client.ts — new methods

async fetchBranchTree(agentId: string, sessionKey: string): Promise<BranchTree>;
async fetchLineage(agentId: string, sessionKey: string): Promise<SessionLineage>;
```

---

## Files Touched

### New files
| File | Responsibility |
|------|---------------|
| `server/runtime/session-tools.ts` | Session tool implementations (7 tools) |
| `server/runtime/sub-agent-registry.ts` | Sub-agent spawn tracking, yield support |
| `server/runtime/maintenance-scheduler.ts` | Background maintenance interval |
| `server/runtime/cron-scheduler.ts` | Cron job scheduling via node-cron |
| `server/runtime/webhook-handler.ts` | Webhook route registration and dispatch |
| `src/nodes/CronNode.tsx` | Cron node canvas component |
| `src/panels/property-editors/CronProperties.tsx` | Cron node property editor |
| `src/components/BranchIndicator.tsx` | Fork point indicator in timeline |
| `src/components/BranchSwitcher.tsx` | Branch selection popover |
| `src/components/SessionLineageBar.tsx` | Parent session breadcrumb |
| `server/runtime/session-tools.test.ts` | Session tools unit tests |
| `server/runtime/sub-agent-registry.test.ts` | SubAgentRegistry unit tests |
| `server/runtime/maintenance-scheduler.test.ts` | Maintenance scheduler tests |
| `server/runtime/cron-scheduler.test.ts` | CronScheduler unit tests |

### Modified files
| File | Change |
|------|--------|
| `src/types/nodes.ts` | Add `CronNodeData`, maintenance fields to `StorageNodeData`, update `FlowNodeData` union |
| `src/utils/default-nodes.ts` | Add cron defaults, maintenance defaults to storage |
| `shared/agent-config.ts` | Add `ResolvedCronConfig`, maintenance fields to `ResolvedStorageConfig`, `crons` to `AgentConfig` |
| `shared/storage-types.ts` | Add `parentSessionId`, `ForkPoint`, `BranchInfo`, `BranchTree`, `SessionLineage` types |
| `src/utils/graph-to-agent.ts` | Resolve cron nodes, pass maintenance fields |
| `server/runtime/tool-factory.ts` | Add session tool names to `ALL_TOOL_NAMES`, `createSessionTools()` function |
| `server/runtime/storage-engine.ts` | Add maintenance methods (pruning, orphan cleanup, disk budget, rotation) |
| `server/runtime/session-router.ts` | Handle `cron:*` and `hook:*` key prefixes, set `parentSessionId` on fork |
| `server/agents/run-coordinator.ts` | Inject session tools, integrate SubAgentRegistry, handle sub-agent completion |
| `server/index.ts` | Add maintenance endpoints, webhook routes, branch/lineage endpoints |
| `src/nodes/node-registry.ts` | Register `cron: CronNode` |
| `src/store/session-store.ts` | Add `activeBranch`, branch tree/lineage actions |
| `src/runtime/storage-client.ts` | Add branch tree, lineage, maintenance client methods |
| `src/panels/property-editors/StorageProperties.tsx` | Add Maintenance config section |
| `src/settings/sections/DataMaintenanceSection.tsx` | Add "Run Maintenance" button |
| `package.json` | Add `node-cron` dependency |
| `server/runtime/storage-engine.test.ts` | Add maintenance method tests |

### Docs to update
| File | Change |
|------|--------|
| `docs/concepts/storage-node.md` | Maintenance config, new fields |
| New: `docs/concepts/cron-node.md` | Cron node concept doc |
| `docs/concepts/_manifest.json` | Add cron entry |
