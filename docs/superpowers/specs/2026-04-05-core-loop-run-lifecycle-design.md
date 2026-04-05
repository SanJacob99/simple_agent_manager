# Core Loop & Run Lifecycle — Layer 1 Design

<!-- last-verified: 2026-04-05 -->

This is the first of four layers that implement the full agent loop architecture described in `notes/agent.md`. This layer introduces run dispatch, session resolution, lifecycle events, timeout/abort handling, and the `wait()` mechanism. It is the foundation that layers 2-4 build on.

## Layers Overview

1. **Core Loop & Run Lifecycle** (this spec)
2. Concurrency & Session Serialization (future)
3. Streaming & Reply Shaping (future)
4. Hooks & Plugin Lifecycle (future)

## Architectural Approach

**Coordinator pattern.** A new `RunCoordinator` class sits between `AgentManager` and `AgentRuntime`. It owns all run orchestration. `AgentRuntime` stays unchanged as a thin wrapper around pi-agent-core's `Agent` class.

**Wrap, don't replace.** pi-agent-core's `Agent` still owns model inference and tool execution. The coordinator adds run tracking, lifecycle events, session resolution, and timeouts on top.

**Internal API first.** The coordinator exposes a programmatic API that both the WebSocket handler and agent-to-agent tool calls consume. No WebSocket-specific logic in the core.

## Components

### New

#### `RunCoordinator` (`server/agents/run-coordinator.ts`)

One per managed agent. Owns:
- Run dispatch and `runId` generation
- Session resolution (`sessionKey` to `sessionId`)
- Timeout enforcement (per-run, configurable per agent)
- Lifecycle event emission
- `wait()` promise resolution
- Optional per-run stream subscription
- Payload buffering and usage capture

#### `RunRecord` (`server/agents/run-coordinator.ts`)

Plain data object tracking a single run's state. Held in a `Map<runId, RunRecord>` inside the coordinator.

Fields:
- `runId: string` — UUID
- `agentId: string`
- `sessionId: string`
- `status: 'pending' | 'running' | 'completed' | 'error'`
- `startedAt: number`
- `endedAt?: number`
- `payloads: RunPayload[]`
- `usage?: RunUsage`
- `error?: StructuredError`
- `abortController: AbortController`
- `timeoutTimer: ReturnType<typeof setTimeout> | null`

Completed/errored records are kept for a 5-minute grace period so late `wait()` callers can still retrieve results, then evicted.

### Modified

#### `AgentManager` (`server/agents/agent-manager.ts`)

- Gains `dispatch()`, `wait()`, `subscribe()`, `abortRun()` as facade methods that delegate to the agent's `RunCoordinator`
- Loses `prompt()` (replaced by `dispatch()`)
- `ManagedAgent` gains `coordinator: RunCoordinator` and `storage: StorageEngine | null`
- `ManagedAgent` loses `status` and `activeSessionId` (now tracked per-run in `RunRecord`)

#### `EventBridge` (`server/agents/event-bridge.ts`)

- Subscribes to `RunCoordinator` events instead of raw `AgentRuntime` events
- Constructor takes `(agentId, coordinator)` instead of `(agentId)`
- Maps coordinator lifecycle events to new WebSocket protocol events
- Maps coordinator stream events using existing mapping logic, with `runId` added
- Emits backwards-compatible `agent:end` / `agent:error` alongside new lifecycle events

#### `ws-handler` (`server/connections/ws-handler.ts`)

- `agent:prompt` replaced by `agent:dispatch`
- New `run:wait` command
- `agent:abort` accepts `runId` (or aborts the latest run for backwards compat)

#### `SessionMeta` (`shared/storage-types.ts`)

- Gains `sessionKey: string` field

#### `StorageEngine` (`server/runtime/storage-engine.ts`)

- New `getSessionByKey(sessionKey: string): Promise<SessionMeta | null>` method

### Unchanged

#### `AgentRuntime` (`server/runtime/agent-runtime.ts`)

Stays as the pi-agent-core wrapper. Exposes `prompt()`, `abort()`, `destroy()`, `subscribe()`. The coordinator calls these.

## RunCoordinator API

```typescript
interface DispatchParams {
  sessionKey: string;
  text: string;
  attachments?: ImageAttachment[];
  timeoutMs?: number;          // per-run override, falls back to agent config default
}

interface DispatchResult {
  runId: string;
  acceptedAt: number;
}

interface WaitResult {
  runId: string;
  status: 'ok' | 'error' | 'timeout';
  startedAt: number;
  endedAt?: number;
  payloads: RunPayload[];
  usage?: RunUsage;
  error?: StructuredError;
}

interface StructuredError {
  code: 'model_refused' | 'rate_limited' | 'timeout' | 'aborted' | 'internal';
  message: string;
  retriable: boolean;
}

interface RunPayload {
  type: 'text' | 'tool_summary' | 'error';
  content: string;
}

interface RunUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

// Listener for per-run stream events (message deltas, tool events)
type RunEventListener = (event: CoordinatorEvent) => void;

class RunCoordinator {
  constructor(
    agentId: string,
    runtime: AgentRuntime,
    config: AgentConfig,
    storage: StorageEngine | null,
  );

  dispatch(params: DispatchParams): Promise<DispatchResult>;
  wait(runId: string, timeoutMs?: number): Promise<WaitResult>;
  subscribe(runId: string, listener: RunEventListener): () => void;
  subscribeAll(listener: (event: CoordinatorEvent) => void): () => void;
  abort(runId: string): void;
  getRunStatus(runId: string): RunRecord | undefined;
  destroy(): void;
}
```

- `dispatch()` is async (session resolution hits the filesystem) but fast — it validates, resolves the session, creates the `RunRecord`, starts the async execution (fire-and-forget), and returns `{ runId, acceptedAt }`. The pi-agent-core execution is not awaited.
- `wait()` returns a promise that resolves when the run reaches a terminal state or the wait timeout expires. Resolves immediately if the run is already finished.
- `subscribe(runId)` forwards runtime events for a specific run. Returns an unsubscribe function.
- `subscribeAll()` forwards all events for all runs. Used by `EventBridge`.
- `abort(runId)` aborts a specific run, not the whole agent.
- `destroy()` aborts all active runs and cleans up timers.

## Session Resolution

Session resolution happens inside `dispatch()` and integrates with `StorageEngine` to respect storage node constraints.

### Steps

1. **Resolve storage.** The coordinator holds a reference to the agent's `StorageEngine`. If no storage config exists, dispatch fails with a structured error (`code: 'internal'`).

2. **Lookup by sessionKey.** Call `StorageEngine.getSessionByKey(sessionKey)` to find an existing session.

3. **If found.** Use the existing `sessionId`. Update `updatedAt` on the meta.

4. **If not found.** Create a new session:
   - Generate a `sessionId` (UUID)
   - Build a `SessionMeta` with both `sessionKey` and `sessionId`
   - Call `StorageEngine.createSession(meta)` to create the JSONL file
   - Call `StorageEngine.enforceRetention(config.storage.sessionRetention)` to prune old sessions if the limit is exceeded

5. **Guard against concurrent runs.** Reject the dispatch if a run is already active on that `sessionId`. (Full queuing comes in Layer 2; for now, one run per session is enforced with a rejection.)

### SessionMeta Changes

```typescript
interface SessionMeta {
  sessionId: string;
  sessionKey: string;          // NEW
  sessionFile: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
```

### StorageEngine Changes

New method:

```typescript
async getSessionByKey(sessionKey: string): Promise<SessionMeta | null> {
  const sessions = await this.readIndex();
  return sessions.find((s) => s.sessionKey === sessionKey) ?? null;
}
```

## Run Lifecycle

### States

```
pending  →  running  →  completed
                     →  error
```

### Execution Flow

1. **Emit `lifecycle:start`** — `{ runId, agentId, sessionId, startedAt }`
2. **Start timeout timer** — uses `params.timeoutMs` or falls back to `config.runTimeoutMs` (default per agent). Runs are fire-and-forget; `wait()` is purely observational.
3. **Subscribe to AgentRuntime events** scoped to this run:
   - Forward message/tool events to any run subscribers
   - Buffer assistant text deltas into payloads
   - Capture usage from `message_end`
4. **Call `runtime.prompt(text, attachments)`** — pi-agent-core runs its loop
5. **On success:**
   - Clear timeout timer
   - Assemble final payloads + usage into `RunRecord`
   - Set status to `completed`
   - Emit `lifecycle:end` with payloads and usage
   - Resolve all `wait()` promises
6. **On error:**
   - Clear timeout timer
   - Classify error into `StructuredError`
   - Set status to `error`
   - Emit `lifecycle:error`
   - Resolve all `wait()` promises
7. **On timeout:**
   - Call `runtime.abort()`
   - Classify as `{ code: 'timeout', retriable: false }`
   - Follow error path
8. **On external abort:**
   - Call `runtime.abort()`
   - Classify as `{ code: 'aborted', retriable: false }`
   - Follow error path

### Error Classification

```typescript
function classifyError(error: unknown): StructuredError {
  // Rate limit from provider  →  { code: 'rate_limited', retriable: true }
  // Content policy / refusal  →  { code: 'model_refused', retriable: false }
  // Timeout (from our timer)  →  { code: 'timeout',       retriable: false }
  // Abort (user/agent cancel) →  { code: 'aborted',       retriable: false }
  // Everything else           →  { code: 'internal',      retriable: false }
}
```

### Payload Buffering

As runtime events stream in:
- `message_update` (text_delta) accumulates into a text payload
- `message_end` finalizes the text payload and captures usage
- `tool_execution_end` is stored as a tool_summary payload (tool name + truncated result)

`RunRecord.payloads` contains the final assembled array that `wait()` returns.

### Run Record Cleanup

Completed/errored records are kept for 5 minutes so late `wait()` callers can retrieve results. After that they are evicted from the map.

## AgentManager Facade

```typescript
class AgentManager {
  // Existing (unchanged)
  start(config: AgentConfig): void;
  destroy(agentId: string): void;
  has(agentId: string): boolean;
  getStatus(agentId: string): string;
  addSocket(agentId: string, socket: WebSocket): void;
  removeSocketFromAll(socket: WebSocket): void;
  shutdown(): Promise<void>;
  restoreFromDisk(storagePath: string): Promise<number>;

  // Removed
  // prompt() — replaced by dispatch()

  // New
  dispatch(agentId: string, params: DispatchParams): Promise<DispatchResult>;
  wait(agentId: string, runId: string, timeoutMs?: number): Promise<WaitResult>;
  subscribe(agentId: string, runId: string, listener: RunEventListener): () => void;
  abortRun(agentId: string, runId: string): void;
}
```

### ManagedAgent

```typescript
interface ManagedAgent {
  runtime: AgentRuntime;
  coordinator: RunCoordinator;
  config: AgentConfig;
  bridge: EventBridge;
  storage: StorageEngine | null;
  lastActivity: number;
  unsubscribe: () => void;
}
```

`status` and `activeSessionId` are removed — now tracked per-run in `RunRecord`.

### start() Wiring

1. Create `StorageEngine` from `config.storage` (if present), call `init()`
2. Create `AgentRuntime` (unchanged)
3. Create `RunCoordinator(agentId, runtime, config, storageEngine)`
4. Create `EventBridge(agentId, coordinator)`
5. Store `ManagedAgent`

## WebSocket Protocol Changes

### Commands (frontend to backend)

```typescript
// Replaces agent:prompt
interface AgentDispatchCommand {
  type: 'agent:dispatch';
  agentId: string;
  sessionKey: string;
  text: string;
  attachments?: ImageAttachment[];
}

// New
interface RunWaitCommand {
  type: 'run:wait';
  agentId: string;
  runId: string;
  timeoutMs?: number;
}
```

`agent:start`, `agent:destroy`, `agent:sync`, `config:setApiKeys` are unchanged.

`agent:abort` gains an optional `runId`. If omitted, aborts the most recent active run for that agent.

### run:accepted Emission

`run:accepted` is emitted by the WebSocket handler (not the coordinator) immediately after `dispatch()` resolves. It is a WebSocket-level acknowledgment, not a lifecycle event. The handler calls `dispatch()`, receives `{ runId, acceptedAt }`, and sends `run:accepted` back to the socket with the resolved `sessionId`.

### Events (backend to frontend)

New events:

```typescript
interface RunAcceptedEvent {
  type: 'run:accepted';
  agentId: string;
  runId: string;
  sessionId: string;
  acceptedAt: number;
}

interface LifecycleStartEvent {
  type: 'lifecycle:start';
  agentId: string;
  runId: string;
  sessionId: string;
  startedAt: number;
}

interface LifecycleEndEvent {
  type: 'lifecycle:end';
  agentId: string;
  runId: string;
  status: 'ok';
  startedAt: number;
  endedAt: number;
  payloads: RunPayload[];
  usage?: RunUsage;
}

interface LifecycleErrorEvent {
  type: 'lifecycle:error';
  agentId: string;
  runId: string;
  status: 'error';
  error: StructuredError;
  startedAt: number;
  endedAt: number;
}
```

Existing streaming events (`message:start`, `message:delta`, `message:end`, `tool:start`, `tool:end`) gain a `runId` field but are otherwise unchanged.

### Backwards Compatibility

`EventBridge` emits both:
- New lifecycle events (`lifecycle:start`, `lifecycle:end`, `lifecycle:error`)
- Old events (`agent:end`, `agent:error`)

This lets the existing frontend work while it is migrated to the new protocol. Old events are dropped once the frontend is updated.

## EventBridge Evolution

### Coordinator Event Types

```typescript
type CoordinatorEvent =
  | { type: 'lifecycle:start'; runId: string; agentId: string; sessionId: string; startedAt: number }
  | { type: 'lifecycle:end'; runId: string; status: 'ok'; startedAt: number; endedAt: number; payloads: RunPayload[]; usage?: RunUsage }
  | { type: 'lifecycle:error'; runId: string; status: 'error'; error: StructuredError; startedAt: number; endedAt: number }
  | { type: 'stream'; runId: string; event: RuntimeEvent };
```

### Bridge Mapping

| Coordinator Event | WebSocket Event(s) |
|---|---|
| `lifecycle:start` | `lifecycle:start` |
| `lifecycle:end` | `lifecycle:end` + `agent:end` (backwards compat) |
| `lifecycle:error` | `lifecycle:error` + `agent:error` (backwards compat) |
| `stream` (message_start) | `message:start` + `runId` |
| `stream` (message_update text_delta) | `message:delta` + `runId` |
| `stream` (message_end) | `message:end` + `runId` |
| `stream` (tool_execution_start) | `tool:start` + `runId` |
| `stream` (tool_execution_end) | `tool:end` + `runId` |

### Bridge Constructor

```typescript
class EventBridge {
  constructor(agentId: string, coordinator: RunCoordinator) {
    coordinator.subscribeAll((event) => {
      this.handleCoordinatorEvent(event);
    });
  }
}
```

`subscribeAll` receives all events for all runs. Distinct from `subscribe(runId)` which scopes to one run.

## Agent-to-Agent Path

When Agent A's tool calls Agent B, the tool implementation uses the same internal API:

```typescript
const { runId } = await manager.dispatch(targetAgentId, { sessionKey, text });
const result = await manager.wait(targetAgentId, runId, 30000);
return result.payloads; // returned as tool result to Agent A
```

No WebSocket involved.

## Timeout Model

- **Run timeout** is the hard ceiling on agent execution. Configurable per agent (added to `AgentConfig`). Default: 172800000ms (48 hours) as a safety net; agents should configure shorter values appropriate to their use case. Enforced by an abort timer inside `RunCoordinator`. When hit, the run is killed.
- **Wait timeout** is how long a caller blocks on `wait()`. Default 30 seconds. When hit, the caller gets `{ status: 'timeout' }` but the run continues in the background.
- Runs are fire-and-forget. The run timeout is the only thing that stops a run. `wait()` is purely observational.

## Files Changed

| File | Change |
|---|---|
| `server/agents/run-coordinator.ts` | New file |
| `server/agents/agent-manager.ts` | Add dispatch/wait/subscribe facade, remove prompt(), update ManagedAgent |
| `server/agents/event-bridge.ts` | Subscribe to coordinator instead of runtime |
| `server/connections/ws-handler.ts` | agent:dispatch, run:wait commands, runId on abort |
| `server/runtime/storage-engine.ts` | Add getSessionByKey() |
| `shared/storage-types.ts` | Add sessionKey to SessionMeta |
| `shared/protocol.ts` | Add new commands and events, add runId to streaming events |
| `shared/agent-config.ts` | Add runTimeoutMs to AgentConfig |

## Out of Scope (future layers)

- Per-session and global concurrency queuing (Layer 2)
- Reply shaping and suppression — NO_REPLY filtering, messaging tool dedup, verbose tool summaries (Layer 3)
- Hook system — internal and plugin lifecycle hooks (Layer 4)
- Compaction-triggered retries
- Prompt assembly and system prompt building changes
