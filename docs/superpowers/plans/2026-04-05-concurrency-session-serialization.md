# Concurrency & Session Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement queued run admission, per-session serialization, per-agent global arbitration, explicit queue events, and `run:wait:result` without breaking the Layer 1 run lifecycle foundation.

**Architecture:** Add a dedicated `RunConcurrencyController` that owns per-session queues, the per-agent global lane, and in-memory session write leases. Keep `RunCoordinator` as the lifecycle orchestrator: it still resolves sessions, creates run records, emits lifecycle events, buffers payloads, handles timeouts/abort, and resolves `wait()`, but it now delegates queue admission, promotion, and release to the controller. The WebSocket layer remains passive: real lifecycle and queue events come from `EventBridge`, while `run:wait` returns a separate observational result event.

**Tech Stack:** TypeScript, Vitest, Node.js, WebSocket (`ws`), pi-agent-core

**Spec:** `docs/superpowers/specs/2026-04-05-concurrency-session-serialization-design.md`

**Important considerations:**
- `AgentRuntime` still wraps one shared pi-agent-core `Agent` instance, so this plan preserves an effective capacity of one running loop per managed agent even though runs can queue.
- `acceptedAt` and `startedAt` diverge in this layer. Do not start timeout timers or emit `lifecycle:start` while a run is still pending.
- A pending run can now end in `aborted` without ever emitting `lifecycle:start`; the tests need to lock that in so later layers do not accidentally assume start is mandatory.
- `run:wait` is observational only. It must not synthesize lifecycle traffic because that would confuse the queue state and make wait timeouts look like real run failures.

**Assumptions:**
- In-memory queues and leases are sufficient for now; restart persistence for pending runs is intentionally deferred.
- The backend remains single-process, so no filesystem or distributed locking is required in this layer.

---

## File Structure

| File | Role |
|---|---|
| `shared/run-types.ts` | MODIFY — extend `WaitResult`, add queue event unions, and carry queue snapshots in a shared shape |
| `shared/protocol.ts` | MODIFY — add `queue:*` server events and `run:wait:result` |
| `server/agents/run-concurrency-controller.ts` | CREATE — own per-session lanes, global lane, active slot, and session write leases |
| `server/agents/run-concurrency-controller.test.ts` | CREATE — black-box controller tests for queueing, arbitration, abort, and lease release |
| `server/agents/run-coordinator.ts` | MODIFY — switch from reject-on-busy to queue admission and controller-driven promotion/release |
| `server/agents/run-coordinator.test.ts` | MODIFY — cover pending runs, automatic promotion, pending abort, and richer `wait()` results |
| `server/agents/event-bridge.ts` | MODIFY — forward queue events from coordinator |
| `server/agents/event-bridge.test.ts` | MODIFY — verify queue event mapping |
| `server/connections/ws-handler.ts` | MODIFY — return `run:wait:result` instead of synthetic lifecycle events |
| `server/connections/ws-handler.test.ts` | CREATE — verify socket command handling for `run:wait` and accepted queue behavior |
| `server/agents/agent-manager.test.ts` | MODIFY — verify manager facade still behaves correctly when a run can remain pending |
| `src/client/agent-client.test.ts` | MODIFY — verify the frontend client accepts queue events and `run:wait:result` transparently |

---

### Task 1: Build The Concurrency Controller First

**Files:**
- Create: `server/agents/run-concurrency-controller.ts`
- Create: `server/agents/run-concurrency-controller.test.ts`

- [ ] **Step 1: Write failing controller tests**

Create `server/agents/run-concurrency-controller.test.ts` with focused, black-box tests that define the queue semantics before any production code exists:

```ts
import { describe, expect, it } from 'vitest';
import { RunConcurrencyController } from './run-concurrency-controller';

describe('RunConcurrencyController', () => {
  it('assigns 1-based session and global queue positions on enqueue', () => {
    const controller = new RunConcurrencyController();

    const first = controller.enqueue('run-1', 'sess-a');
    const second = controller.enqueue('run-2', 'sess-a');
    const third = controller.enqueue('run-3', 'sess-b');

    expect(first.snapshot).toEqual({ sessionPosition: 1, globalPosition: 1 });
    expect(second.snapshot).toEqual({ sessionPosition: 2, globalPosition: 2 });
    expect(third.snapshot).toEqual({ sessionPosition: 1, globalPosition: 3 });
  });

  it('drain starts the earliest global run that is also a session head', () => {
    const controller = new RunConcurrencyController();

    controller.enqueue('run-1', 'sess-a');
    controller.enqueue('run-2', 'sess-a');
    controller.enqueue('run-3', 'sess-b');

    expect(controller.drain()).toEqual({ runId: 'run-1', sessionId: 'sess-a' });

    controller.start('run-1', 'sess-a');
    expect(controller.drain()).toBeNull();

    controller.release('run-1', 'sess-a');
    expect(controller.drain()).toEqual({ runId: 'run-3', sessionId: 'sess-b' });
  });

  it('abortPending removes a queued run and updates the remaining snapshots', () => {
    const controller = new RunConcurrencyController();

    controller.enqueue('run-1', 'sess-a');
    controller.enqueue('run-2', 'sess-b');
    controller.enqueue('run-3', 'sess-b');

    const result = controller.abortPending('run-2');

    expect(result.removed).toBe(true);
    expect(controller.getSnapshot('run-2')).toBeNull();
    expect(controller.getSnapshot('run-3')).toEqual({ sessionPosition: 1, globalPosition: 2 });
  });
});
```

- [ ] **Step 2: Run the controller tests to verify the failure**

Run: `npm run test:run -- server/agents/run-concurrency-controller.test.ts`

Expected: FAIL because `server/agents/run-concurrency-controller.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal controller**

Create `server/agents/run-concurrency-controller.ts` with a small, explicit API:

```ts
export interface QueueSnapshot {
  sessionPosition: number;
  globalPosition: number;
}

export interface DrainDecision {
  runId: string;
  sessionId: string;
}

export class RunConcurrencyController {
  private sessionQueues = new Map<string, string[]>();
  private globalQueue: string[] = [];
  private runToSession = new Map<string, string>();
  private activeRunId: string | null = null;
  private leasedSessionId: string | null = null;

  enqueue(runId: string, sessionId: string) { /* push into both queues, return snapshot */ }
  getSnapshot(runId: string): QueueSnapshot | null { /* derive 1-based positions */ }
  drain(): DrainDecision | null { /* first global entry that is also a session head and no active run */ }
  start(runId: string, sessionId: string) { /* remove from pending queues, set activeRunId + leasedSessionId, return affected queued runs */ }
  abortPending(runId: string) { /* remove only if not active */ }
  release(runId: string, sessionId: string) { /* clear active slot, recompute affected snapshots */ }
  destroy(): string[] { /* return remaining pending runIds */ }
}
```

Important implementation note: `drain()` should not remove the selected run from the queues by itself. Keep queue mutation explicit through `start()` so the coordinator can emit `queue:left(reason='started')` and then `queue:updated` for the newly advanced pending runs at a predictable moment before lifecycle start.

- [ ] **Step 4: Run the controller tests again**

Run: `npm run test:run -- server/agents/run-concurrency-controller.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/run-concurrency-controller.ts server/agents/run-concurrency-controller.test.ts
git commit -m "feat: add run concurrency controller for queued session serialization"
```

---

### Task 2: Lock In Coordinator Queue Behavior With Tests

**Files:**
- Modify: `server/agents/run-coordinator.test.ts`

- [ ] **Step 1: Add failing tests for queued dispatch and pending waits**

Append tests to `server/agents/run-coordinator.test.ts` that describe the new behavior:

```ts
it('accepts a second dispatch on the same session and leaves it pending', async () => {
  const deferred = createDeferred<void>();
  (runtime.prompt as any).mockImplementationOnce(() => deferred.promise);

  const first = await coordinator.dispatch({ sessionKey: 'same', text: 'First' });
  const second = await coordinator.dispatch({ sessionKey: 'same', text: 'Second' });

  const secondRecord = coordinator.getRunStatus(second.runId)!;
  expect(secondRecord.status).toBe('pending');
  expect(secondRecord.queue).toEqual({ sessionPosition: 2, globalPosition: 2 });

  deferred.resolve();
  await coordinator.wait(first.runId, 5000);
});

it('returns phase pending when wait times out before a queued run starts', async () => {
  const deferred = createDeferred<void>();
  (runtime.prompt as any).mockImplementationOnce(() => deferred.promise);

  await coordinator.dispatch({ sessionKey: 'same', text: 'First' });
  const second = await coordinator.dispatch({ sessionKey: 'same', text: 'Second' });

  const result = await coordinator.wait(second.runId, 25);
  expect(result.status).toBe('timeout');
  expect(result.phase).toBe('pending');
  expect(result.queue).toEqual({ sessionPosition: 2, globalPosition: 2 });

  deferred.resolve();
});

it('aborts a pending run without calling runtime.abort', async () => {
  const deferred = createDeferred<void>();
  (runtime.prompt as any).mockImplementationOnce(() => deferred.promise);

  const events: any[] = [];
  coordinator.subscribeAll((event) => events.push(event));

  await coordinator.dispatch({ sessionKey: 'same', text: 'First' });
  const second = await coordinator.dispatch({ sessionKey: 'same', text: 'Second' });

  coordinator.abort(second.runId);
  const result = await coordinator.wait(second.runId, 1000);

  expect(result.status).toBe('error');
  expect(result.error?.code).toBe('aborted');
  expect(runtime.abort).toHaveBeenCalledTimes(0);
  expect(events.some((e) => e.type === 'queue:left' && e.reason === 'aborted')).toBe(true);
});
```

Use a local helper like:

```ts
function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
```

- [ ] **Step 2: Run the coordinator tests to verify the failure**

Run: `npm run test:run -- server/agents/run-coordinator.test.ts`

Expected: FAIL with the current Layer 1 behavior because:
- second same-session dispatch still throws
- `WaitResult` has no `phase` or `queue`
- queue events do not exist
- pending abort still calls `runtime.abort()`

- [ ] **Step 3: Add one more failing test for automatic promotion after release**

Add a test that proves the next eligible queued run starts automatically when the running run ends:

```ts
it('starts the next eligible queued run when the active run finishes', async () => {
  const first = createDeferred<void>();
  const second = createDeferred<void>();

  (runtime.prompt as any)
    .mockImplementationOnce(() => first.promise)
    .mockImplementationOnce(() => second.promise);

  const run1 = await coordinator.dispatch({ sessionKey: 'sess-a', text: 'First' });
  const run2 = await coordinator.dispatch({ sessionKey: 'sess-b', text: 'Second' });

  expect(coordinator.getRunStatus(run2.runId)?.status).toBe('pending');

  first.resolve();
  await coordinator.wait(run1.runId, 5000);

  expect(coordinator.getRunStatus(run2.runId)?.status).toBe('running');

  second.resolve();
  await coordinator.wait(run2.runId, 5000);
});
```

- [ ] **Step 4: Re-run the coordinator tests**

Run: `npm run test:run -- server/agents/run-coordinator.test.ts`

Expected: still FAIL, now with explicit evidence that queue drain/promotion logic is missing.

---

### Task 3: Implement Shared Types, Protocol, And Coordinator Integration

**Files:**
- Modify: `shared/run-types.ts`
- Modify: `shared/protocol.ts`
- Modify: `server/agents/run-coordinator.ts`

- [ ] **Step 1: Extend the shared run types**

Update `shared/run-types.ts` to carry queue-aware shapes:

```ts
export interface RunQueueSnapshot {
  sessionPosition: number;
  globalPosition: number;
}

export interface WaitResult {
  runId: string;
  status: 'ok' | 'error' | 'timeout';
  phase: 'pending' | 'running' | 'completed' | 'error';
  acceptedAt: number;
  startedAt?: number;
  endedAt?: number;
  queue?: RunQueueSnapshot;
  payloads: RunPayload[];
  usage?: RunUsage;
  error?: StructuredError;
}

export type CoordinatorEvent =
  | { type: 'queue:entered'; runId: string; agentId: string; sessionId: string; acceptedAt: number; sessionPosition: number; globalPosition: number }
  | { type: 'queue:updated'; runId: string; agentId: string; sessionId: string; updatedAt: number; sessionPosition: number; globalPosition: number }
  | { type: 'queue:left'; runId: string; agentId: string; sessionId: string; leftAt: number; reason: 'started' | 'aborted' | 'destroyed' }
  | { type: 'lifecycle:start'; runId: string; agentId: string; sessionId: string; startedAt: number }
  | { type: 'lifecycle:end'; runId: string; status: 'ok'; startedAt: number; endedAt: number; payloads: RunPayload[]; usage?: RunUsage }
  | { type: 'lifecycle:error'; runId: string; status: 'error'; error: StructuredError; startedAt?: number; endedAt: number }
  | { type: 'stream'; runId: string; event: unknown };
```

Important consideration: make `startedAt` optional on `lifecycle:error` because queued-aborted runs never start.

- [ ] **Step 2: Update the protocol surface**

Extend `shared/protocol.ts` with the queue events and a dedicated wait result event:

```ts
export interface QueueEnteredEvent {
  type: 'queue:entered';
  agentId: string;
  runId: string;
  sessionId: string;
  acceptedAt: number;
  sessionPosition: number;
  globalPosition: number;
}

export interface QueueUpdatedEvent {
  type: 'queue:updated';
  agentId: string;
  runId: string;
  sessionId: string;
  updatedAt: number;
  sessionPosition: number;
  globalPosition: number;
}

export interface QueueLeftEvent {
  type: 'queue:left';
  agentId: string;
  runId: string;
  sessionId: string;
  leftAt: number;
  reason: 'started' | 'aborted' | 'destroyed';
}

export interface RunWaitResultEvent extends WaitResult {
  type: 'run:wait:result';
  agentId: string;
}
```

Then add them to the `ServerEvent` union.

- [ ] **Step 3: Replace the Layer 1 busy-session guard in the coordinator**

Refactor `server/agents/run-coordinator.ts` around the controller:

```ts
private readonly concurrency = new RunConcurrencyController();

async dispatch(params: DispatchParams): Promise<DispatchResult> {
  const sessionId = await this.resolveSession(params.sessionKey);
  const runId = randomUUID();
  const acceptedAt = Date.now();

  const record: RunRecord = {
    runId,
    agentId: this.agentId,
    sessionId,
    status: 'pending',
    acceptedAt,
    payloads: [],
    abortController: new AbortController(),
    timeoutTimer: null,
  };

  this.runs.set(runId, record);

  const { snapshot, affectedRunIds } = this.concurrency.enqueue(runId, sessionId);
  record.queue = snapshot;
  this.emitQueueEntered(record);
  this.emitQueueUpdates(affectedRunIds, runId);
  this.tryStartNextRun(params);

  return { runId, sessionId, acceptedAt };
}
```

Then add:
- `tryStartNextRun()` to call `concurrency.drain()`
- `concurrency.start(runId, sessionId)` inside the promotion path so the started run leaves the pending queues immediately
- `startQueuedRun(record, params)` to set `startedAt`, emit `queue:left(reason='started')`, emit `lifecycle:start`, and call the old runtime execution path
- `buildWaitResult()` that includes `phase`, `acceptedAt`, and `queue`
- abort branching: pending abort goes through `concurrency.abortPending()`, running abort still calls `runtime.abort()`
- finalization hooks that call `concurrency.release()` and emit `queue:updated` for affected pending runs

Use a small `pendingParams` map if needed:

```ts
private pendingParams = new Map<string, DispatchParams>();
```

That lets `tryStartNextRun()` recover the original `text`, `attachments`, and optional `timeoutMs` when a queued run is finally promoted.

- [ ] **Step 4: Run the controller and coordinator tests**

Run: `npm run test:run -- server/agents/run-concurrency-controller.test.ts server/agents/run-coordinator.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/run-types.ts shared/protocol.ts server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts
git commit -m "feat: queue coordinator runs by session and agent lanes"
```

---

### Task 4: Bridge Queue Events And Fix The `run:wait` Socket Contract

**Files:**
- Modify: `server/agents/event-bridge.ts`
- Modify: `server/agents/event-bridge.test.ts`
- Modify: `server/connections/ws-handler.ts`
- Create: `server/connections/ws-handler.test.ts`

- [ ] **Step 1: Add failing bridge tests for queue events**

Append tests to `server/agents/event-bridge.test.ts`:

```ts
it('maps queue:entered to queue:entered server event', () => {
  const coordinator = mockCoordinator();
  const bridge = new EventBridge('agent-1', coordinator);
  const socket = mockSocket();
  bridge.addSocket(socket);

  emitCoordinatorEvent(coordinator, {
    type: 'queue:entered',
    runId: 'run-1',
    agentId: 'agent-1',
    sessionId: 'sess-1',
    acceptedAt: 1000,
    sessionPosition: 1,
    globalPosition: 2,
  });

  const sent = JSON.parse(socket.send.mock.calls[0][0]);
  expect(sent.type).toBe('queue:entered');
  expect(sent.globalPosition).toBe(2);
});
```

Add similar coverage for `queue:updated` and `queue:left`.

- [ ] **Step 2: Add a failing handler test for `run:wait:result`**

Create `server/connections/ws-handler.test.ts` with a mocked socket and manager:

```ts
import { describe, expect, it, vi } from 'vitest';
import { handleConnection } from './ws-handler';

it('responds to run:wait with run:wait:result', async () => {
  const socket = makeMockSocket();
  const manager = {
    wait: vi.fn(async () => ({
      runId: 'run-1',
      status: 'timeout',
      phase: 'pending',
      acceptedAt: 1000,
      payloads: [],
      queue: { sessionPosition: 2, globalPosition: 3 },
    })),
    removeSocketFromAll: vi.fn(),
  } as any;

  handleConnection(socket, manager, { setAll: vi.fn() } as any);

  await socket.emitMessage({ type: 'run:wait', agentId: 'agent-1', runId: 'run-1', timeoutMs: 10 });

  const sent = JSON.parse(socket.send.mock.calls[0][0]);
  expect(sent.type).toBe('run:wait:result');
  expect(sent.phase).toBe('pending');
});
```

- [ ] **Step 3: Run the bridge and handler tests to verify the failure**

Run: `npm run test:run -- server/agents/event-bridge.test.ts server/connections/ws-handler.test.ts`

Expected: FAIL because:
- the bridge ignores queue events
- there is no `ws-handler.test.ts` support yet
- `run:wait` still sends fake lifecycle events

- [ ] **Step 4: Implement the bridge and socket changes**

Update `server/agents/event-bridge.ts`:

```ts
case 'queue:entered':
  this.broadcast({
    type: 'queue:entered',
    agentId: this.agentId,
    runId: event.runId,
    sessionId: event.sessionId,
    acceptedAt: event.acceptedAt,
    sessionPosition: event.sessionPosition,
    globalPosition: event.globalPosition,
  } as any);
  break;
```

Add equivalent branches for `queue:updated` and `queue:left`.

Update `server/connections/ws-handler.ts`:

```ts
case 'run:wait': {
  const waitResult = await manager.wait(command.agentId, command.runId, command.timeoutMs);
  socket.send(JSON.stringify({
    type: 'run:wait:result',
    agentId: command.agentId,
    ...waitResult,
  }));
  break;
}
```

Important consideration: do not emit lifecycle events from the handler. That responsibility remains entirely with the coordinator and bridge.

- [ ] **Step 5: Re-run the bridge and handler tests**

Run: `npm run test:run -- server/agents/event-bridge.test.ts server/connections/ws-handler.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/agents/event-bridge.ts server/agents/event-bridge.test.ts server/connections/ws-handler.ts server/connections/ws-handler.test.ts
git commit -m "feat: emit queue events and return run wait results over ws"
```

---

### Task 5: Update Manager And Client Contract Tests

**Files:**
- Modify: `server/agents/agent-manager.test.ts`
- Modify: `src/client/agent-client.test.ts`
- Modify if needed: `server/agents/agent-manager.ts`

- [ ] **Step 1: Add failing manager tests for queued semantics**

Extend `server/agents/agent-manager.test.ts` with one test that proves multiple same-session dispatches are accepted:

```ts
it('accepts queued dispatches for the same session', async () => {
  await manager.start(makeConfig());

  const runtime = (manager as any).agents.get('agent-1').runtime;
  const deferred = createDeferred<void>();
  runtime.prompt.mockImplementationOnce(() => deferred.promise);

  const first = await manager.dispatch('agent-1', { sessionKey: 'same', text: 'First' });
  const second = await manager.dispatch('agent-1', { sessionKey: 'same', text: 'Second' });

  expect(first.runId).not.toBe(second.runId);
  expect(manager.getStatus('agent-1')).toBe('running');

  deferred.resolve();
});
```

Add a second test that aborts a pending run through the manager facade and expects `error.code === 'aborted'`.

- [ ] **Step 2: Add failing client tests for new event types**

Append to `src/client/agent-client.test.ts`:

```ts
it('dispatches queue events to listeners', async () => {
  client.connect();
  await new Promise((r) => setTimeout(r, 10));

  const handler = vi.fn();
  client.onEvent(handler);

  mockWsInstance.onmessage?.({
    data: JSON.stringify({
      type: 'queue:entered',
      agentId: 'a1',
      runId: 'run-1',
      sessionId: 'sess-1',
      acceptedAt: 1000,
      sessionPosition: 1,
      globalPosition: 2,
    }),
  });

  expect(handler).toHaveBeenCalled();
});

it('dispatches run:wait:result to listeners', async () => {
  client.connect();
  await new Promise((r) => setTimeout(r, 10));

  const handler = vi.fn();
  client.onEvent(handler);

  mockWsInstance.onmessage?.({
    data: JSON.stringify({
      type: 'run:wait:result',
      agentId: 'a1',
      runId: 'run-1',
      status: 'timeout',
      phase: 'pending',
      acceptedAt: 1000,
      payloads: [],
    }),
  });

  expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'run:wait:result' }));
});
```

- [ ] **Step 3: Run the manager and client tests**

Run: `npm run test:run -- server/agents/agent-manager.test.ts src/client/agent-client.test.ts`

Expected: FAIL until the shared protocol/types and coordinator behavior are all wired through cleanly.

- [ ] **Step 4: Make the smallest code changes needed**

This should usually be light-touch:
- keep `server/agents/agent-manager.ts` mostly unchanged
- only adjust typings or helper methods if the richer `WaitResult` or queue semantics require it
- avoid inventing new manager APIs unless the tests prove a real need

- [ ] **Step 5: Re-run the manager and client tests**

Run: `npm run test:run -- server/agents/agent-manager.test.ts src/client/agent-client.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/agents/agent-manager.ts server/agents/agent-manager.test.ts src/client/agent-client.test.ts
git commit -m "test: cover queued dispatch behavior across manager and client contracts"
```

---

### Task 6: Full Verification And Cleanup

**Files:**
- Modify: any touched files from Tasks 1-5 if verification reveals gaps

- [ ] **Step 1: Run the focused server/runtime suite**

Run:

```bash
npm run test:run -- server/agents/run-concurrency-controller.test.ts server/agents/run-coordinator.test.ts server/agents/event-bridge.test.ts server/connections/ws-handler.test.ts server/agents/agent-manager.test.ts
```

Expected: PASS

- [ ] **Step 2: Run the client regression test**

Run:

```bash
npm run test:run -- src/client/agent-client.test.ts
```

Expected: PASS

- [ ] **Step 3: Run the full test suite**

Run:

```bash
npm run test:run
```

Expected: PASS

- [ ] **Step 4: Run a build for type-level regressions**

Run:

```bash
npm run build
```

Expected: PASS

- [ ] **Step 5: Final cleanup commit if verification required any follow-up edits**

```bash
git add shared/protocol.ts shared/run-types.ts server/agents/run-concurrency-controller.ts server/agents/run-concurrency-controller.test.ts server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts server/agents/event-bridge.ts server/agents/event-bridge.test.ts server/connections/ws-handler.ts server/connections/ws-handler.test.ts server/agents/agent-manager.ts server/agents/agent-manager.test.ts src/client/agent-client.test.ts
git commit -m "fix: finalize concurrency session serialization verification"
```

If no verification fixes were needed, skip this commit.

---

## Notes For The Implementer

- Keep the controller black-box and deterministic. Avoid leaking coordinator concerns like payload buffering into it.
- Do not start runtime work or timeout timers for pending runs. Promotion from `pending` to `running` is the boundary where timers, streaming, and lifecycle start begin.
- Preserve the Layer 1 cleanup behavior that retains terminal records briefly for late `wait()` callers.
- When emitting `queue:updated`, only notify runs whose position actually changed. Over-emitting will create noisy UI updates and brittle tests.
- `destroy()` should cleanly handle both running and pending runs. Pending runs should be finalized without touching `runtime.abort()`. Running runs should still follow the runtime abort path.
