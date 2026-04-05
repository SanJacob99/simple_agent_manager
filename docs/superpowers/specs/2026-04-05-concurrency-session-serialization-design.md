# Concurrency & Session Serialization - Layer 2 Design

<!-- last-verified: 2026-04-05 -->

This is the second of four layers that implement the full agent loop architecture described in `notes/agent.md`. Layer 1 introduced run dispatch, lifecycle tracking, `wait()`, timeout handling, and aborts. Layer 2 adds queued execution, per-session serialization, a per-agent global lane, and session write leases so multi-run and multi-session scenarios stay consistent.

## Layers Overview

1. Core Loop & Run Lifecycle
2. **Concurrency & Session Serialization** (this spec)
3. Streaming & Reply Shaping
4. Hooks & Plugin Lifecycle

## Problem

Layer 1 stops concurrent writes by rejecting a second dispatch on the same session. That protects session history, but it is not enough for the architecture in `notes/agent.md`:

- runs should be accepted immediately and allowed to wait in a queue
- execution should stay serialized per session
- a per-agent global lane should prevent unsafe overlap inside a managed agent
- queued runs must still support `wait()`, abort, and explicit UI visibility

Today `RunCoordinator` already owns lifecycle orchestration, but it also hard-rejects busy sessions and assumes dispatch implies immediate execution. This layer keeps `RunCoordinator` as the lifecycle orchestrator while moving queueing and serialization policy into a dedicated per-agent concurrency component.

## Decisions

- **Approach:** add a dedicated per-agent `RunConcurrencyController` and keep `RunCoordinator` focused on lifecycle orchestration.
- **Dispatch contract:** `dispatch()` accepts work immediately, creates a `pending` run, enqueues it, and returns `{ runId, sessionId, acceptedAt }` even if execution cannot start yet.
- **Per-session serialization:** runs for the same `sessionId` execute strictly FIFO.
- **Per-agent global lane:** one managed agent has one in-memory global execution lane. It is scoped per agent, not backend-wide.
- **Execution capacity:** effective capacity is `1` active run per managed agent in this layer because `AgentRuntime` still wraps one shared pi-agent-core `Agent` instance.
- **Queue visibility:** explicit queue events are emitted. Queue state is not inferred indirectly from lifecycle events.
- **Abort semantics:** aborting a `pending` run removes it from the queue immediately and finalizes it as `aborted` without calling `runtime.abort()`.
- **Wait semantics:** `run:wait` remains observational and gets its own response event. Real lifecycle events only come from the coordinator/bridge.
- **Session write lock model:** use an in-memory per-session write lease owned by the concurrency controller. No filesystem or OS locking in this layer.

## Important Considerations

- The current `AgentRuntime` uses one shared runtime instance per managed agent. Even if the queue model becomes more expressive, actual execution overlap inside one managed agent is still unsafe until the runtime becomes run-isolated.
- Queue visibility needs to be explicit because `acceptedAt` and `startedAt` now diverge. The UI should be able to say "accepted and waiting" without pretending the run has started.
- A queued run can now terminate without ever emitting `lifecycle:start`. Any code that assumed start is mandatory before error must be updated.
- `run:wait` should not synthesize lifecycle traffic. A wait timeout is not a lifecycle failure, and a queued run timing out in `wait()` should not be reported as an agent error.
- The global lane should avoid cross-session head-of-line blocking. A blocked second run for session A should not prevent a ready run for session B from starting.

## Assumptions

- In-memory queueing is sufficient for this layer. Queue durability across backend restart is out of scope.
- The backend remains single-process. Cross-process coordination and distributed locks are not required here.
- Storage continues to be append-oriented and raw. This layer defines serialization boundaries but does not redesign transcript persistence.
- Frontend and internal callers can be updated to handle `startedAt` being absent while a run is still queued or if it is aborted before starting.

---

## 1. Architecture

### New Component: `RunConcurrencyController`

Create `server/agents/run-concurrency-controller.ts`.

One instance exists per managed agent and is owned by that agent's `RunCoordinator`.

Responsibilities:

- maintain per-session FIFO pending lanes: `sessionId -> runId[]`
- maintain one per-agent global pending lane: `runId[]`
- track the active run occupying the agent execution slot
- track the active per-session write lease
- admit runs into the queue and compute queue positions
- remove pending runs on abort or destroy
- select the next start-eligible run when capacity is available
- release queue and lease ownership when a run reaches a terminal state

### Existing Component: `RunCoordinator`

`RunCoordinator` remains the orchestrator for:

- session resolution
- run record creation and state transitions
- lifecycle and stream event emission
- timeout and abort handling
- payload buffering and usage capture
- `wait()` resolution

It no longer owns queue data structures directly. Instead it delegates queue admission, promotion, and release to `RunConcurrencyController`.

## 2. Run State Model

### `RunRecord`

`RunRecord` continues to live in `server/agents/run-coordinator.ts`, but its timing and queue fields change:

```ts
type RunStatus = 'pending' | 'running' | 'completed' | 'error';

interface RunQueueState {
  sessionPosition: number;
  globalPosition: number;
}

interface RunRecord {
  runId: string;
  agentId: string;
  sessionId: string;
  status: RunStatus;
  acceptedAt: number;
  startedAt?: number;
  endedAt?: number;
  queue?: RunQueueState;
  payloads: RunPayload[];
  usage?: RunUsage;
  error?: StructuredError;
  abortController: AbortController;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}
```

### State Transitions

```text
dispatch accepted -> pending -> running -> completed
                                  -> error

dispatch accepted -> pending -> error(aborted before start)
```

Rules:

- `acceptedAt` is set when `dispatch()` succeeds
- `startedAt` is set only when the run acquires the execution slot and begins runtime work
- `endedAt` is set only on terminal states
- `queue` is populated while the run is pending and cleared once it leaves the queue

## 3. Queue Model

### Per-Session Lane

Each session gets a FIFO queue of pending `runId`s.

- ordering key: dispatch acceptance order
- invariant: only the head of the session lane is eligible to start
- effect: no overlapping writes or loop execution on the same session

### Per-Agent Global Lane

Each managed agent has one FIFO lane spanning all queued runs for that agent.

- ordering key: dispatch acceptance order
- scoped per managed agent, not backend-wide
- used to arbitrate which session head runs next

### Start Eligibility

A pending run is start-eligible only when:

1. it is at the head of its session lane
2. no other run is actively executing for that managed agent
3. it is the earliest global-lane candidate among the currently start-eligible session heads

The controller should not blindly pick the literal first global entry if that run is blocked behind another run in the same session. Instead, it should pick the earliest global entry that is also the head of its session lane.

This avoids unnecessary cross-session head-of-line blocking.

## 4. Session Write Leases

Layer 2 introduces an in-memory session write lease.

Purpose:

- mark which session currently owns write access inside a managed agent
- create a safe seam for later session preparation and transcript persistence work

Behavior:

- acquired when a `pending` run is promoted to `running`
- held for the full execution lifetime
- released during the same terminal path that resolves waiters and clears timeouts
- never held by pending runs
- removed immediately when a pending run is aborted or the agent is destroyed

This is intentionally not a filesystem lock. The app is single-process today, and this layer only needs in-memory correctness inside one backend process.

## 5. Dispatch Flow

### Updated `dispatch()`

`RunCoordinator.dispatch()` becomes:

1. resolve `sessionKey -> sessionId`
2. create a `RunRecord` in `pending`
3. enqueue the run through `RunConcurrencyController`
4. snapshot queue positions onto the run record
5. emit `queue:entered`
6. ask the controller to drain the queue
7. if the run becomes runnable immediately, transition it to `running` and begin execution
8. return `{ runId, sessionId, acceptedAt }` without waiting for completion

Important behavior change from Layer 1:

- busy same-session dispatches are no longer rejected
- dispatch acceptance no longer implies immediate start

## 6. Execution Start And Release

### Promotion To Running

When the controller promotes a run:

1. remove it from pending queue state
2. acquire the session write lease
3. emit `queue:left` with `reason: 'started'`
4. set `status = 'running'`
5. set `startedAt = Date.now()`
6. emit `lifecycle:start`
7. install the run timeout timer
8. subscribe to runtime events and call `runtime.prompt()`

### Terminal Release

On success, runtime error, timeout, or running abort:

1. clear timeout timer
2. set terminal status and `endedAt`
3. release the session write lease
4. free the per-agent execution slot
5. emit lifecycle end/error
6. resolve waiters
7. schedule record cleanup
8. ask the controller to drain the queue and start the next eligible run

## 7. Queue Events

Add explicit queue events to coordinator events and WebSocket protocol.

### `queue:entered`

Emitted once when a run is accepted and placed into the queue.

```ts
{
  type: 'queue:entered';
  runId: string;
  agentId: string;
  sessionId: string;
  acceptedAt: number;
  sessionPosition: number;
  globalPosition: number;
}
```

### `queue:updated`

Emitted when a pending run's queue position changes.

```ts
{
  type: 'queue:updated';
  runId: string;
  agentId: string;
  sessionId: string;
  updatedAt: number;
  sessionPosition: number;
  globalPosition: number;
}
```

### `queue:left`

Emitted when a run stops being pending.

```ts
{
  type: 'queue:left';
  runId: string;
  agentId: string;
  sessionId: string;
  leftAt: number;
  reason: 'started' | 'aborted' | 'destroyed';
}
```

Rules:

- queue positions are `1`-based
- `queue:updated` fires only on actual position changes
- `queue:left(reason='started')` is emitted immediately before `lifecycle:start`
- `queue:left(reason='aborted')` can be followed by `lifecycle:error` with no preceding `lifecycle:start`

## 8. `wait()` And Protocol Changes

### `WaitResult`

`WaitResult` must reflect pending and running states honestly.

```ts
interface WaitResult {
  runId: string;
  status: 'ok' | 'error' | 'timeout';
  phase: 'pending' | 'running' | 'completed' | 'error';
  acceptedAt: number;
  startedAt?: number;
  endedAt?: number;
  queue?: {
    sessionPosition: number;
    globalPosition: number;
  };
  payloads: RunPayload[];
  usage?: RunUsage;
  error?: StructuredError;
}
```

Semantics:

- if the run is terminal, return final result immediately
- if the run is pending or running, block until terminal state or wait timeout
- if the wait times out, return `status: 'timeout'` with the current `phase`
- a wait timeout does not stop the run and does not change queue state

### WebSocket `run:wait`

Keep lifecycle events sourced only from `RunCoordinator` via `EventBridge`.

Change `ws-handler.ts` so `run:wait` responds with a dedicated event:

```ts
interface RunWaitResultEvent extends WaitResult {
  type: 'run:wait:result';
  agentId: string;
}
```

This replaces the current behavior where `run:wait` synthesizes `lifecycle:end` or `lifecycle:error`.

## 9. Abort Semantics

### Aborting A Pending Run

If `abort(runId)` targets a pending run:

1. remove it from the session lane and global lane
2. emit `queue:left(reason='aborted')`
3. set terminal state to `error`
4. set structured error `{ code: 'aborted', retriable: false }`
5. resolve waiters
6. emit `lifecycle:error`
7. recompute positions and emit `queue:updated` for affected pending runs
8. do **not** call `runtime.abort()`

### Aborting A Running Run

If `abort(runId)` targets a running run:

- keep the existing runtime abort path from Layer 1
- release queue and lease ownership in the terminal path
- drain the queue after finalization

### Aborting A Terminal Run

- no-op

## 10. EventBridge Changes

`EventBridge` continues to subscribe to `RunCoordinator.subscribeAll()`.

Add mappings for:

- `queue:entered`
- `queue:updated`
- `queue:left`

Keep existing lifecycle and stream mappings unchanged.

Backwards compatibility rules:

- continue emitting existing lifecycle/stream events where already defined
- do not invent queue semantics through old event types
- `agent:end` / `agent:error` backwards compatibility from Layer 1 remains intact until frontend migration is complete

## 11. Internal APIs

### `RunConcurrencyController`

Suggested surface:

```ts
interface QueueSnapshot {
  sessionPosition: number;
  globalPosition: number;
}

interface DrainDecision {
  runId: string;
  sessionId: string;
}

class RunConcurrencyController {
  enqueue(runId: string, sessionId: string): {
    snapshot: QueueSnapshot;
    affectedRunIds: string[];
  };

  abortPending(runId: string): {
    removed: boolean;
    sessionId?: string;
    affectedRunIds: string[];
  };

  release(runId: string, sessionId: string): {
    affectedRunIds: string[];
  };

  drain(): DrainDecision | null;
  acquireSessionLease(runId: string, sessionId: string): void;
  destroy(): string[]; // returns pending runIds to finalize as destroyed/aborted
  getSnapshot(runId: string): QueueSnapshot | null;
}
```

This API is intentionally small. The controller knows queueing and leases. The coordinator knows lifecycle and final results.

## 12. Files Changed

| File | Change |
|---|---|
| `server/agents/run-concurrency-controller.ts` | New file |
| `server/agents/run-concurrency-controller.test.ts` | New file |
| `server/agents/run-coordinator.ts` | Replace reject-on-busy behavior with queue/controller orchestration |
| `server/agents/run-coordinator.test.ts` | Add queueing, arbitration, pending abort, and wait timeout coverage |
| `server/agents/event-bridge.ts` | Bridge queue events from coordinator |
| `server/agents/event-bridge.test.ts` | Add queue event mapping tests |
| `server/connections/ws-handler.ts` | Return `run:wait:result` instead of synthetic lifecycle events |
| `server/agents/agent-manager.ts` | No major API change, but semantics shift because dispatch no longer means immediate start |
| `server/agents/agent-manager.test.ts` | Update facade tests for queued dispatch behavior |
| `shared/run-types.ts` | Add queue events and updated `WaitResult` shape |
| `shared/protocol.ts` | Add queue events and `run:wait:result` event |
| `src/client/agent-client.test.ts` | Add wait result event coverage |

## 13. Testing Strategy

### `RunConcurrencyController` tests

- FIFO ordering within one session lane
- global arbitration across multiple session heads
- no cross-session head-of-line blocking
- queue position updates after release
- pending abort removes the run and updates remaining positions
- session lease acquisition and release

### `RunCoordinator` tests

- accepts second dispatch on same session and leaves it pending
- emits `queue:entered` on admission
- emits `queue:updated` when positions change
- automatically starts the next eligible run on release
- pending abort finalizes as `aborted` without calling `runtime.abort()`
- running abort still calls `runtime.abort()`
- `wait()` timeout on pending run reports `phase: 'pending'`
- `wait()` timeout on running run reports `phase: 'running'`
- destroy clears queued runs and prevents leaked leases

### Protocol/bridge tests

- queue events are forwarded to sockets with correct fields
- `run:wait` returns `run:wait:result`
- lifecycle events continue to come only from the coordinator/bridge

## 14. Out Of Scope

This layer does **not** include:

- reply shaping or `NO_REPLY` suppression
- verbose tool summaries
- messaging tool dedup
- plugin hooks or internal lifecycle hooks
- durable queue recovery across restart
- backend-wide or cross-agent throttling
- filesystem or OS-level locking
- transcript/session persistence redesign
- compaction-triggered retries

## 15. Summary

Layer 2 turns dispatch into queue admission, adds strict per-session serialization, keeps execution capacity safe with a per-agent global lane, and makes queued work observable and abortable. The key architectural choice is to keep lifecycle orchestration in `RunCoordinator` while moving queue and lease policy into a dedicated `RunConcurrencyController`. That keeps the core loop foundation intact and gives Layers 3 and 4 a clean place to plug in streaming, reply shaping, and hooks without tangling concurrency concerns into every run path.
