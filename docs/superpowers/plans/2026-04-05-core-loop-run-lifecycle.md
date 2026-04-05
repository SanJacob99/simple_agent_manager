# Core Loop & Run Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement RunCoordinator-based agent run dispatch with session resolution, lifecycle events, timeout/abort, wait(), and the updated WebSocket protocol.

**Architecture:** A new `RunCoordinator` class sits between `AgentManager` and `AgentRuntime`. It owns run dispatch, session resolution (sessionKey → sessionId), lifecycle event emission, timeout enforcement, and the `wait()` mechanism. `AgentRuntime` stays unchanged as the pi-agent-core wrapper. `EventBridge` evolves to consume coordinator events. The WebSocket protocol gains `agent:dispatch`, `run:wait`, and lifecycle events.

**Tech Stack:** TypeScript, vitest, pi-agent-core, ws (WebSocket), Node.js crypto (UUID)

**Spec:** `docs/superpowers/specs/2026-04-05-core-loop-run-lifecycle-design.md`

---

## File Structure

| File | Role |
|---|---|
| `shared/run-types.ts` | NEW — Shared types: `DispatchParams`, `DispatchResult`, `WaitResult`, `RunPayload`, `RunUsage`, `StructuredError`, `CoordinatorEvent`, `RunEventListener` |
| `shared/storage-types.ts` | MODIFY — Add `sessionKey` to `SessionMeta` |
| `shared/agent-config.ts` | MODIFY — Add `runTimeoutMs` to `AgentConfig` |
| `shared/protocol.ts` | MODIFY — Add new commands/events, add `runId` to streaming events |
| `server/runtime/storage-engine.ts` | MODIFY — Add `getSessionByKey()` |
| `server/agents/run-coordinator.ts` | NEW — `RunCoordinator` class and `RunRecord` |
| `server/agents/agent-manager.ts` | MODIFY — Add dispatch/wait/subscribe facade, remove prompt(), update ManagedAgent/start() |
| `server/agents/event-bridge.ts` | MODIFY — Subscribe to coordinator instead of runtime |
| `server/connections/ws-handler.ts` | MODIFY — New commands: agent:dispatch, run:wait |

---

### Task 1: Shared Types — `shared/run-types.ts`

**Files:**
- Create: `shared/run-types.ts`
- Test: No test file (pure type definitions)

- [ ] **Step 1: Create the shared run types file**

```typescript
// shared/run-types.ts
// Note: shared/ must not import from server/. Stream events use `unknown` for the wrapped event.

export interface DispatchParams {
  sessionKey: string;
  text: string;
  attachments?: import('./protocol').ImageAttachment[];
  timeoutMs?: number;
}

export interface DispatchResult {
  runId: string;
  sessionId: string;
  acceptedAt: number;
}

export interface WaitResult {
  runId: string;
  status: 'ok' | 'error' | 'timeout';
  startedAt: number;
  endedAt?: number;
  payloads: RunPayload[];
  usage?: RunUsage;
  error?: StructuredError;
}

export interface StructuredError {
  code: 'model_refused' | 'rate_limited' | 'timeout' | 'aborted' | 'internal';
  message: string;
  retriable: boolean;
}

export interface RunPayload {
  type: 'text' | 'tool_summary' | 'error';
  content: string;
}

export interface RunUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export type CoordinatorEvent =
  | { type: 'lifecycle:start'; runId: string; agentId: string; sessionId: string; startedAt: number }
  | { type: 'lifecycle:end'; runId: string; status: 'ok'; startedAt: number; endedAt: number; payloads: RunPayload[]; usage?: RunUsage }
  | { type: 'lifecycle:error'; runId: string; status: 'error'; error: StructuredError; startedAt: number; endedAt: number }
  | { type: 'stream'; runId: string; event: unknown };

export type RunEventListener = (event: CoordinatorEvent) => void;
```

- [ ] **Step 2: Verify the file compiles**

Run: `npx tsc --noEmit shared/run-types.ts`

If there are import path issues (RuntimeEvent is a server type that can't be imported from shared), the `CoordinatorEvent` stream variant should use a generic `unknown` for the event payload instead:

```typescript
export type CoordinatorEvent =
  | { type: 'lifecycle:start'; runId: string; agentId: string; sessionId: string; startedAt: number }
  | { type: 'lifecycle:end'; runId: string; status: 'ok'; startedAt: number; endedAt: number; payloads: RunPayload[]; usage?: RunUsage }
  | { type: 'lifecycle:error'; runId: string; status: 'error'; error: StructuredError; startedAt: number; endedAt: number }
  | { type: 'stream'; runId: string; event: unknown };
```

Use the `unknown` variant if the import fails. The server code will cast when needed.

- [ ] **Step 3: Commit**

```bash
git add shared/run-types.ts
git commit -m "feat: add shared run lifecycle types (DispatchParams, WaitResult, CoordinatorEvent)"
```

---

### Task 2: Add `sessionKey` to `SessionMeta` and `getSessionByKey()` to `StorageEngine`

**Files:**
- Modify: `shared/storage-types.ts:1-3` (add sessionKey field)
- Modify: `server/runtime/storage-engine.ts` (add getSessionByKey method)
- Test: `server/runtime/storage-engine.test.ts`

- [ ] **Step 1: Write the failing test for `getSessionByKey`**

Add this test block at the end of the `session CRUD` describe block in `server/runtime/storage-engine.test.ts`:

```typescript
it('finds a session by sessionKey', async () => {
  await engine.createSession({
    sessionId: 'sess-key-1',
    sessionKey: 'my-session',
    agentName: 'test-agent',
    llmSlug: 'anthropic/claude-sonnet-4-20250514',
    startedAt: '2026-04-03T10:00:00.000Z',
    updatedAt: '2026-04-03T10:00:00.000Z',
    sessionFile: 'sessions/sess-key-1.jsonl',
    contextTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalEstimatedCostUsd: 0,
    totalTokens: 0,
  });

  const found = await engine.getSessionByKey('my-session');
  expect(found).not.toBeNull();
  expect(found!.sessionId).toBe('sess-key-1');
  expect(found!.sessionKey).toBe('my-session');

  const notFound = await engine.getSessionByKey('nonexistent');
  expect(notFound).toBeNull();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/runtime/storage-engine.test.ts -t "finds a session by sessionKey"`
Expected: FAIL — `sessionKey` does not exist on `SessionMeta`, `getSessionByKey` is not a function.

- [ ] **Step 3: Add `sessionKey` to `SessionMeta`**

In `shared/storage-types.ts`, add `sessionKey` after `sessionId`:

```typescript
export interface SessionMeta {
  sessionId: string;
  sessionKey?: string;
  agentName: string;
  // ... rest unchanged
}
```

Make it optional (`sessionKey?`) so existing sessions without the field don't break. New sessions will always include it.

- [ ] **Step 4: Add `getSessionByKey()` to `StorageEngine`**

In `server/runtime/storage-engine.ts`, add this method to the `StorageEngine` class after the `getSessionMeta` method:

```typescript
async getSessionByKey(sessionKey: string): Promise<SessionMeta | null> {
  const sessions = await this.readIndex();
  return sessions.find((s) => s.sessionKey === sessionKey) ?? null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run server/runtime/storage-engine.test.ts -t "finds a session by sessionKey"`
Expected: PASS

- [ ] **Step 6: Run the full storage engine test suite**

Run: `npx vitest run server/runtime/storage-engine.test.ts`
Expected: All tests PASS. Existing tests still work because `sessionKey` is optional.

- [ ] **Step 7: Commit**

```bash
git add shared/storage-types.ts server/runtime/storage-engine.ts server/runtime/storage-engine.test.ts
git commit -m "feat: add sessionKey to SessionMeta and getSessionByKey() to StorageEngine"
```

---

### Task 3: Add `runTimeoutMs` to `AgentConfig`

**Files:**
- Modify: `shared/agent-config.ts:84-107` (add runTimeoutMs)

- [ ] **Step 1: Add `runTimeoutMs` to `AgentConfig`**

In `shared/agent-config.ts`, add the field to the `AgentConfig` interface after `sourceGraphId`:

```typescript
export interface AgentConfig {
  // ... existing fields ...
  sourceGraphId: string;
  runTimeoutMs: number;         // Hard ceiling on run execution. Default: 172800000 (48h)
}
```

- [ ] **Step 2: Add the default in the graph-to-agent resolution**

Find where `AgentConfig` is constructed (in `src/utils/graph-to-agent.ts` or wherever `resolveAgentConfig` lives). Add `runTimeoutMs: 172800000` as the default. Read the file first to find the exact location.

- [ ] **Step 3: Update the test fixture `makeConfig` helper**

In `server/agents/agent-manager.test.ts`, add `runTimeoutMs: 172800000` to the `makeConfig` function's return value:

```typescript
function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    // ... existing fields ...
    sourceGraphId: 'agent-1',
    runTimeoutMs: 172800000,
    ...overrides,
  };
}
```

- [ ] **Step 4: Verify tests still pass**

Run: `npx vitest run server/agents/agent-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add shared/agent-config.ts server/agents/agent-manager.test.ts
git commit -m "feat: add runTimeoutMs to AgentConfig (default 48h)"
```

Note: If `graph-to-agent.ts` was modified, include it in the commit too.

---

### Task 4: Update `shared/protocol.ts` — New Commands and Events

**Files:**
- Modify: `shared/protocol.ts`

- [ ] **Step 1: Add new command types**

In `shared/protocol.ts`, add these interfaces after the existing command interfaces:

```typescript
export interface AgentDispatchCommand {
  type: 'agent:dispatch';
  agentId: string;
  sessionKey: string;
  text: string;
  attachments?: ImageAttachment[];
}

export interface RunWaitCommand {
  type: 'run:wait';
  agentId: string;
  runId: string;
  timeoutMs?: number;
}
```

- [ ] **Step 2: Update `AgentAbortCommand` to accept optional `runId`**

```typescript
export interface AgentAbortCommand {
  type: 'agent:abort';
  agentId: string;
  runId?: string;              // If omitted, aborts the most recent active run
}
```

- [ ] **Step 3: Update the `Command` union to include new types**

```typescript
export type Command =
  | AgentStartCommand
  | AgentPromptCommand          // Keep for backwards compat during transition
  | AgentDispatchCommand
  | AgentAbortCommand
  | AgentDestroyCommand
  | AgentSyncCommand
  | RunWaitCommand
  | SetApiKeysCommand;
```

- [ ] **Step 4: Add new event types**

Add these after the existing event interfaces, importing `RunPayload`, `RunUsage`, `StructuredError` from `./run-types`:

```typescript
import type { RunPayload, RunUsage, StructuredError } from './run-types';

export interface RunAcceptedEvent {
  type: 'run:accepted';
  agentId: string;
  runId: string;
  sessionId: string;
  acceptedAt: number;
}

export interface LifecycleStartEvent {
  type: 'lifecycle:start';
  agentId: string;
  runId: string;
  sessionId: string;
  startedAt: number;
}

export interface LifecycleEndEvent {
  type: 'lifecycle:end';
  agentId: string;
  runId: string;
  status: 'ok';
  startedAt: number;
  endedAt: number;
  payloads: RunPayload[];
  usage?: RunUsage;
}

export interface LifecycleErrorEvent {
  type: 'lifecycle:error';
  agentId: string;
  runId: string;
  status: 'error';
  error: StructuredError;
  startedAt: number;
  endedAt: number;
}
```

- [ ] **Step 5: Add `runId` to existing streaming events**

Add `runId?: string` to each of: `MessageStartEvent`, `MessageDeltaEvent`, `MessageEndEvent`, `ToolStartEvent`, `ToolEndEvent`. Make it optional so old code still works.

Example for `MessageDeltaEvent`:

```typescript
export interface MessageDeltaEvent {
  type: 'message:delta';
  agentId: string;
  runId?: string;              // NEW
  delta: string;
}
```

Apply the same pattern to the other four streaming event interfaces.

- [ ] **Step 6: Update the `ServerEvent` union**

```typescript
export type ServerEvent =
  | AgentReadyEvent
  | AgentErrorEvent
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | AgentEndEvent
  | AgentStateEvent
  | RunAcceptedEvent
  | LifecycleStartEvent
  | LifecycleEndEvent
  | LifecycleErrorEvent;
```

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 8: Commit**

```bash
git add shared/protocol.ts shared/run-types.ts
git commit -m "feat: add agent:dispatch, run:wait commands and lifecycle events to protocol"
```

---

### Task 5: Implement `RunCoordinator` — Core Structure and Dispatch

**Files:**
- Create: `server/agents/run-coordinator.ts`
- Create: `server/agents/run-coordinator.test.ts`

- [ ] **Step 1: Write the failing test for dispatch**

Create `server/agents/run-coordinator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunCoordinator } from './run-coordinator';
import type { AgentConfig } from '../../shared/agent-config';
import type { AgentRuntime } from '../runtime/agent-runtime';
import type { StorageEngine } from '../runtime/storage-engine';
import type { SessionMeta } from '../../shared/storage-types';

function mockRuntime(): AgentRuntime {
  return {
    prompt: vi.fn(() => Promise.resolve()),
    abort: vi.fn(),
    destroy: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    state: { messages: [] },
  } as any;
}

function mockStorage(): StorageEngine {
  const sessions: SessionMeta[] = [];
  return {
    getSessionByKey: vi.fn(async (key: string) => {
      return sessions.find((s) => s.sessionKey === key) ?? null;
    }),
    createSession: vi.fn(async (meta: SessionMeta) => {
      sessions.push(meta);
    }),
    updateSessionMeta: vi.fn(),
    enforceRetention: vi.fn(),
    listSessions: vi.fn(async () => sessions),
  } as any;
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    version: 3,
    name: 'Test Agent',
    description: '',
    tags: [],
    provider: 'openai',
    modelId: 'gpt-4',
    thinkingLevel: 'none',
    systemPrompt: {
      mode: 'manual',
      sections: [{ key: 'manual', label: 'Manual Prompt', content: 'Test', tokenEstimate: 1 }],
      assembled: 'Test',
      userInstructions: 'Test',
    },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: {
      label: 'Storage',
      backendType: 'filesystem',
      storagePath: '/tmp/test',
      sessionRetention: 50,
      memoryEnabled: false,
      dailyMemoryEnabled: false,
    },
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    runTimeoutMs: 172800000,
    ...overrides,
  };
}

describe('RunCoordinator', () => {
  let runtime: AgentRuntime;
  let storage: StorageEngine;
  let coordinator: RunCoordinator;

  beforeEach(() => {
    runtime = mockRuntime();
    storage = mockStorage();
    coordinator = new RunCoordinator('agent-1', runtime, makeConfig(), storage);
  });

  describe('dispatch', () => {
    it('returns a runId, sessionId, and acceptedAt', async () => {
      const result = await coordinator.dispatch({ sessionKey: 'test-session', text: 'Hello' });

      expect(result.runId).toBeDefined();
      expect(typeof result.runId).toBe('string');
      expect(result.runId.length).toBeGreaterThan(0);
      expect(result.sessionId).toBeDefined();
      expect(typeof result.sessionId).toBe('string');
      expect(result.acceptedAt).toBeDefined();
      expect(typeof result.acceptedAt).toBe('number');
    });

    it('creates a new session when sessionKey is not found', async () => {
      await coordinator.dispatch({ sessionKey: 'new-session', text: 'Hello' });

      expect(storage.getSessionByKey).toHaveBeenCalledWith('new-session');
      expect(storage.createSession).toHaveBeenCalledTimes(1);
      const createdMeta = (storage.createSession as any).mock.calls[0][0] as SessionMeta;
      expect(createdMeta.sessionKey).toBe('new-session');
      expect(createdMeta.sessionId).toBeDefined();
    });

    it('reuses existing session when sessionKey is found', async () => {
      // First dispatch creates the session
      await coordinator.dispatch({ sessionKey: 'reuse-session', text: 'First' });
      // Wait for the first run to complete
      const firstResult = await coordinator.dispatch({ sessionKey: 'reuse-session', text: 'First' });
      await coordinator.wait(firstResult.runId, 5000);

      // Second dispatch reuses
      await coordinator.dispatch({ sessionKey: 'reuse-session', text: 'Second' });

      // createSession called only once (from the first dispatch)
      expect(storage.createSession).toHaveBeenCalledTimes(1);
    });

    it('enforces retention after creating a new session', async () => {
      await coordinator.dispatch({ sessionKey: 'retention-test', text: 'Hello' });

      expect(storage.enforceRetention).toHaveBeenCalledWith(50);
    });

    it('rejects dispatch when a run is already active on the same session', async () => {
      // Make runtime.prompt hang to keep the run active
      (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

      await coordinator.dispatch({ sessionKey: 'busy-session', text: 'First' });

      await expect(
        coordinator.dispatch({ sessionKey: 'busy-session', text: 'Second' })
      ).rejects.toThrow(/already active/i);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/agents/run-coordinator.test.ts`
Expected: FAIL — `run-coordinator.ts` does not exist.

- [ ] **Step 3: Implement `RunCoordinator` — dispatch and session resolution**

Create `server/agents/run-coordinator.ts`:

```typescript
import { randomUUID } from 'crypto';
import type { AgentRuntime, RuntimeEvent } from '../runtime/agent-runtime';
import type { StorageEngine } from '../runtime/storage-engine';
import type { AgentConfig } from '../../shared/agent-config';
import type { SessionMeta } from '../../shared/storage-types';
import type {
  DispatchParams,
  DispatchResult,
  WaitResult,
  RunPayload,
  RunUsage,
  StructuredError,
  CoordinatorEvent,
  RunEventListener,
} from '../../shared/run-types';

export type RunStatus = 'pending' | 'running' | 'completed' | 'error';

export interface RunRecord {
  runId: string;
  agentId: string;
  sessionId: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  payloads: RunPayload[];
  usage?: RunUsage;
  error?: StructuredError;
  abortController: AbortController;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

const RUN_RECORD_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;

export class RunCoordinator {
  private runs = new Map<string, RunRecord>();
  private waiters = new Map<string, Array<(result: WaitResult) => void>>();
  private runSubscribers = new Map<string, Set<RunEventListener>>();
  private allSubscribers = new Set<RunEventListener>();
  private activeSessionRuns = new Map<string, string>(); // sessionId → runId
  private unsubscribeRuntime: (() => void) | null = null;

  constructor(
    private readonly agentId: string,
    private readonly runtime: AgentRuntime,
    private readonly config: AgentConfig,
    private readonly storage: StorageEngine | null,
  ) {}

  async dispatch(params: DispatchParams): Promise<DispatchResult> {
    if (!this.storage) {
      throw new Error('Cannot dispatch: no storage configured for this agent');
    }

    // Resolve session
    const sessionId = await this.resolveSession(params.sessionKey);

    // Guard: one run per session
    if (this.activeSessionRuns.has(sessionId)) {
      throw new Error(`A run is already active on session ${sessionId}`);
    }

    // Create run record
    const runId = randomUUID();
    const startedAt = Date.now();
    const abortController = new AbortController();

    const record: RunRecord = {
      runId,
      agentId: this.agentId,
      sessionId,
      status: 'pending',
      startedAt,
      payloads: [],
      abortController,
      timeoutTimer: null,
    };

    this.runs.set(runId, record);
    this.activeSessionRuns.set(sessionId, runId);

    // Fire-and-forget the execution
    this.executeRun(record, params);

    return { runId, sessionId, acceptedAt: startedAt };
  }

  async wait(runId: string, timeoutMs?: number): Promise<WaitResult> {
    const record = this.runs.get(runId);
    if (!record) {
      return {
        runId,
        status: 'error',
        startedAt: 0,
        payloads: [],
        error: { code: 'internal', message: `Run ${runId} not found`, retriable: false },
      };
    }

    // Already terminal
    if (record.status === 'completed' || record.status === 'error') {
      return this.buildWaitResult(record);
    }

    // Wait for completion or timeout
    const timeout = timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    return new Promise<WaitResult>((resolve) => {
      const timer = setTimeout(() => {
        // Remove this waiter
        const waiters = this.waiters.get(runId);
        if (waiters) {
          const idx = waiters.indexOf(resolve);
          if (idx !== -1) waiters.splice(idx, 1);
        }
        resolve({
          runId,
          status: 'timeout',
          startedAt: record.startedAt,
          payloads: [],
        });
      }, timeout);

      const wrappedResolve = (result: WaitResult) => {
        clearTimeout(timer);
        resolve(result);
      };

      if (!this.waiters.has(runId)) {
        this.waiters.set(runId, []);
      }
      this.waiters.get(runId)!.push(wrappedResolve);
    });
  }

  subscribe(runId: string, listener: RunEventListener): () => void {
    if (!this.runSubscribers.has(runId)) {
      this.runSubscribers.set(runId, new Set());
    }
    this.runSubscribers.get(runId)!.add(listener);
    return () => {
      this.runSubscribers.get(runId)?.delete(listener);
    };
  }

  subscribeAll(listener: RunEventListener): () => void {
    this.allSubscribers.add(listener);
    return () => {
      this.allSubscribers.delete(listener);
    };
  }

  abort(runId: string): void {
    const record = this.runs.get(runId);
    if (!record || record.status === 'completed' || record.status === 'error') return;

    record.abortController.abort();
    this.runtime.abort();
    this.finalizeRun(record, {
      code: 'aborted',
      message: 'Run aborted by caller',
      retriable: false,
    });
  }

  getRunStatus(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  /** Returns the most recent active runId for this agent, if any. */
  getLatestActiveRunId(): string | undefined {
    for (const [, record] of this.runs) {
      if (record.status === 'pending' || record.status === 'running') {
        return record.runId;
      }
    }
    return undefined;
  }

  destroy(): void {
    // Abort all active runs
    for (const [, record] of this.runs) {
      if (record.status === 'pending' || record.status === 'running') {
        record.abortController.abort();
        if (record.timeoutTimer) clearTimeout(record.timeoutTimer);
      }
    }
    this.runs.clear();
    this.waiters.clear();
    this.runSubscribers.clear();
    this.allSubscribers.clear();
    this.activeSessionRuns.clear();
    this.unsubscribeRuntime?.();
  }

  // --- Private ---

  private async resolveSession(sessionKey: string): Promise<string> {
    const existing = await this.storage!.getSessionByKey(sessionKey);
    if (existing) {
      await this.storage!.updateSessionMeta(existing.sessionId, {
        updatedAt: new Date().toISOString(),
      });
      return existing.sessionId;
    }

    // Create new session
    const sessionId = randomUUID();
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      sessionId,
      sessionKey,
      agentName: this.config.name,
      llmSlug: `${this.config.provider}/${this.config.modelId}`,
      startedAt: now,
      updatedAt: now,
      sessionFile: `sessions/${sessionId}.jsonl`,
      contextTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      totalTokens: 0,
    };

    await this.storage!.createSession(meta);
    await this.storage!.enforceRetention(this.config.storage!.sessionRetention);

    return sessionId;
  }

  private executeRun(record: RunRecord, params: DispatchParams): void {
    record.status = 'running';

    // Emit lifecycle:start
    this.emit({
      type: 'lifecycle:start',
      runId: record.runId,
      agentId: this.agentId,
      sessionId: record.sessionId,
      startedAt: record.startedAt,
    });

    // Start timeout timer
    const timeoutMs = params.timeoutMs ?? this.config.runTimeoutMs;
    record.timeoutTimer = setTimeout(() => {
      if (record.status === 'running' || record.status === 'pending') {
        this.runtime.abort();
        this.finalizeRun(record, {
          code: 'timeout',
          message: `Run timed out after ${timeoutMs}ms`,
          retriable: false,
        });
      }
    }, timeoutMs);

    // Subscribe to runtime events for this run
    let textBuffer = '';
    const unsubscribe = this.runtime.subscribe((event: RuntimeEvent) => {
      // Forward stream events
      this.emitForRun(record.runId, { type: 'stream', runId: record.runId, event });

      // Buffer payloads
      if (event.type === 'message_update') {
        const aEvent = (event as any).assistantMessageEvent;
        if (aEvent?.type === 'text_delta') {
          textBuffer += aEvent.delta;
        }
      } else if (event.type === 'message_end') {
        if (textBuffer) {
          record.payloads.push({ type: 'text', content: textBuffer });
          textBuffer = '';
        }
        const usage = (event as any).message?.usage;
        if (usage) {
          record.usage = {
            input: usage.input ?? 0,
            output: usage.output ?? 0,
            cacheRead: usage.cacheRead ?? 0,
            cacheWrite: usage.cacheWrite ?? 0,
            totalTokens: usage.totalTokens ?? 0,
          };
        }
      } else if (event.type === 'tool_execution_end') {
        const te = event as any;
        const resultText = te.result?.content
          ?.map((c: { type: string; text?: string }) => c.type === 'text' ? c.text : '')
          .join('') || '';
        record.payloads.push({
          type: 'tool_summary',
          content: `${te.toolName}: ${resultText.slice(0, 500)}`,
        });
      }
    });

    // Run the prompt
    this.runtime.prompt(params.text, params.attachments)
      .then(() => {
        unsubscribe();
        // Flush remaining text buffer
        if (textBuffer) {
          record.payloads.push({ type: 'text', content: textBuffer });
        }
        this.finalizeRunSuccess(record);
      })
      .catch((error: unknown) => {
        unsubscribe();
        if (textBuffer) {
          record.payloads.push({ type: 'text', content: textBuffer });
        }
        // Don't double-finalize if already handled (timeout/abort)
        if (record.status === 'running') {
          this.finalizeRun(record, classifyError(error));
        }
      });
  }

  private finalizeRunSuccess(record: RunRecord): void {
    if (record.timeoutTimer) clearTimeout(record.timeoutTimer);
    record.status = 'completed';
    record.endedAt = Date.now();
    this.activeSessionRuns.delete(record.sessionId);

    this.emit({
      type: 'lifecycle:end',
      runId: record.runId,
      status: 'ok',
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      payloads: record.payloads,
      usage: record.usage,
    });

    this.resolveWaiters(record);
    this.scheduleCleanup(record.runId);
  }

  private finalizeRun(record: RunRecord, error: StructuredError): void {
    if (record.timeoutTimer) clearTimeout(record.timeoutTimer);
    record.status = 'error';
    record.error = error;
    record.endedAt = Date.now();
    this.activeSessionRuns.delete(record.sessionId);

    this.emit({
      type: 'lifecycle:error',
      runId: record.runId,
      status: 'error',
      error,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
    });

    this.resolveWaiters(record);
    this.scheduleCleanup(record.runId);
  }

  private resolveWaiters(record: RunRecord): void {
    const waiters = this.waiters.get(record.runId);
    if (waiters) {
      const result = this.buildWaitResult(record);
      for (const resolve of waiters) {
        resolve(result);
      }
      this.waiters.delete(record.runId);
    }
  }

  private buildWaitResult(record: RunRecord): WaitResult {
    return {
      runId: record.runId,
      status: record.status === 'completed' ? 'ok' : 'error',
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      payloads: record.payloads,
      usage: record.usage,
      error: record.error,
    };
  }

  private scheduleCleanup(runId: string): void {
    setTimeout(() => {
      this.runs.delete(runId);
      this.runSubscribers.delete(runId);
    }, RUN_RECORD_TTL_MS);
  }

  private emit(event: CoordinatorEvent): void {
    for (const listener of this.allSubscribers) {
      try { listener(event); } catch { /* don't break the loop */ }
    }
  }

  private emitForRun(runId: string, event: CoordinatorEvent): void {
    // Emit to run-specific subscribers
    const subs = this.runSubscribers.get(runId);
    if (subs) {
      for (const listener of subs) {
        try { listener(event); } catch { /* don't break the loop */ }
      }
    }
    // Also emit to all-subscribers
    this.emit(event);
  }
}

export function classifyError(error: unknown): StructuredError {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('429')) {
      return { code: 'rate_limited', message: error.message, retriable: true };
    }
    if (msg.includes('content policy') || msg.includes('refused') || msg.includes('safety')) {
      return { code: 'model_refused', message: error.message, retriable: false };
    }
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  return { code: 'internal', message, retriable: false };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/agents/run-coordinator.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts
git commit -m "feat: implement RunCoordinator with dispatch, session resolution, and concurrency guard"
```

---

### Task 6: `RunCoordinator` — Lifecycle Events, Wait, Timeout, Abort

**Files:**
- Modify: `server/agents/run-coordinator.test.ts` (add lifecycle/wait/timeout/abort tests)

The implementation is already in place from Task 5. This task adds test coverage for the remaining behaviors.

- [ ] **Step 1: Add lifecycle event tests**

Append to the `describe('RunCoordinator')` block in `server/agents/run-coordinator.test.ts`:

```typescript
describe('lifecycle events', () => {
  it('emits lifecycle:start on dispatch', async () => {
    const events: any[] = [];
    coordinator.subscribeAll((event) => events.push(event));

    await coordinator.dispatch({ sessionKey: 'lifecycle-test', text: 'Hello' });

    // Allow the async execution to start
    await new Promise((r) => setTimeout(r, 10));

    const startEvent = events.find((e) => e.type === 'lifecycle:start');
    expect(startEvent).toBeDefined();
    expect(startEvent.agentId).toBe('agent-1');
    expect(startEvent.runId).toBeDefined();
    expect(startEvent.sessionId).toBeDefined();
    expect(startEvent.startedAt).toBeDefined();
  });

  it('emits lifecycle:end on successful completion', async () => {
    const events: any[] = [];
    coordinator.subscribeAll((event) => events.push(event));

    const { runId } = await coordinator.dispatch({ sessionKey: 'success-test', text: 'Hello' });
    await coordinator.wait(runId, 5000);

    const endEvent = events.find((e) => e.type === 'lifecycle:end');
    expect(endEvent).toBeDefined();
    expect(endEvent.status).toBe('ok');
    expect(endEvent.runId).toBe(runId);
    expect(endEvent.startedAt).toBeDefined();
    expect(endEvent.endedAt).toBeDefined();
    expect(endEvent.endedAt).toBeGreaterThanOrEqual(endEvent.startedAt);
  });

  it('emits lifecycle:error when runtime.prompt rejects', async () => {
    (runtime.prompt as any).mockRejectedValueOnce(new Error('Model failed'));

    const events: any[] = [];
    coordinator.subscribeAll((event) => events.push(event));

    const { runId } = await coordinator.dispatch({ sessionKey: 'error-test', text: 'Hello' });
    const result = await coordinator.wait(runId, 5000);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('internal');
    expect(result.error?.message).toBe('Model failed');

    const errorEvent = events.find((e) => e.type === 'lifecycle:error');
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error.code).toBe('internal');
  });
});
```

- [ ] **Step 2: Add wait tests**

```typescript
describe('wait', () => {
  it('resolves immediately if run is already completed', async () => {
    const { runId } = await coordinator.dispatch({ sessionKey: 'wait-done', text: 'Hello' });

    // Wait for run to complete
    await coordinator.wait(runId, 5000);

    // Second wait resolves immediately
    const result = await coordinator.wait(runId, 100);
    expect(result.status).toBe('ok');
  });

  it('returns timeout status when wait exceeds timeout', async () => {
    // Make runtime.prompt hang
    (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

    const { runId } = await coordinator.dispatch({ sessionKey: 'wait-timeout', text: 'Hello' });
    const result = await coordinator.wait(runId, 50);

    expect(result.status).toBe('timeout');
    expect(result.runId).toBe(runId);
  });

  it('returns error for unknown runId', async () => {
    const result = await coordinator.wait('nonexistent-run', 100);
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('internal');
  });
});
```

- [ ] **Step 3: Add timeout and abort tests**

```typescript
describe('timeout', () => {
  it('aborts the run when run timeout expires', async () => {
    (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

    const events: any[] = [];
    coordinator.subscribeAll((event) => events.push(event));

    const { runId } = await coordinator.dispatch({
      sessionKey: 'timeout-test',
      text: 'Hello',
      timeoutMs: 50,
    });

    const result = await coordinator.wait(runId, 5000);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('timeout');
    expect(runtime.abort).toHaveBeenCalled();
  });
});

describe('abort', () => {
  it('aborts an active run and emits lifecycle:error', async () => {
    (runtime.prompt as any).mockImplementation(() => new Promise(() => {}));

    const events: any[] = [];
    coordinator.subscribeAll((event) => events.push(event));

    const { runId } = await coordinator.dispatch({ sessionKey: 'abort-test', text: 'Hello' });

    // Give execution time to start
    await new Promise((r) => setTimeout(r, 10));

    coordinator.abort(runId);

    const result = await coordinator.wait(runId, 1000);
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('aborted');
    expect(runtime.abort).toHaveBeenCalled();
  });

  it('does nothing for completed runs', async () => {
    const { runId } = await coordinator.dispatch({ sessionKey: 'abort-done', text: 'Hello' });
    await coordinator.wait(runId, 5000);

    // This should be a no-op
    coordinator.abort(runId);
    const record = coordinator.getRunStatus(runId);
    expect(record?.status).toBe('completed');
  });
});
```

- [ ] **Step 4: Add per-run subscribe test**

```typescript
describe('subscribe', () => {
  it('delivers stream events only for the subscribed run', async () => {
    const events: any[] = [];

    const { runId } = await coordinator.dispatch({ sessionKey: 'sub-test', text: 'Hello' });
    coordinator.subscribe(runId, (event) => events.push(event));

    await coordinator.wait(runId, 5000);

    // Should have received stream events for this run
    const streamEvents = events.filter((e) => e.type === 'stream');
    for (const e of streamEvents) {
      expect(e.runId).toBe(runId);
    }
  });
});
```

- [ ] **Step 5: Run all coordinator tests**

Run: `npx vitest run server/agents/run-coordinator.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/agents/run-coordinator.test.ts
git commit -m "test: add lifecycle, wait, timeout, abort, and subscribe tests for RunCoordinator"
```

---

### Task 7: Update `AgentManager` — Dispatch Facade

**Files:**
- Modify: `server/agents/agent-manager.ts`
- Modify: `server/agents/agent-manager.test.ts`

- [ ] **Step 1: Write failing tests for the new facade methods**

Replace the test file `server/agents/agent-manager.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentManager } from './agent-manager';
import { ApiKeyStore } from '../auth/api-keys';
import type { AgentConfig } from '../../shared/agent-config';

// Mock AgentRuntime to avoid pi-agent-core model resolution
vi.mock('../runtime/agent-runtime', () => {
  class MockAgentRuntime {
    subscribe = vi.fn(() => vi.fn());
    prompt = vi.fn(() => Promise.resolve());
    abort = vi.fn();
    destroy = vi.fn();
    state = { messages: [] };
  }
  return { AgentRuntime: MockAgentRuntime };
});

// Mock StorageEngine to avoid filesystem
vi.mock('../runtime/storage-engine', () => {
  class MockStorageEngine {
    private sessions: any[] = [];
    init = vi.fn();
    getSessionByKey = vi.fn(async (key: string) => {
      return this.sessions.find((s: any) => s.sessionKey === key) ?? null;
    });
    createSession = vi.fn(async (meta: any) => {
      this.sessions.push(meta);
    });
    updateSessionMeta = vi.fn();
    enforceRetention = vi.fn();
    listSessions = vi.fn(async () => this.sessions);
  }
  return { StorageEngine: MockStorageEngine };
});

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    version: 3,
    name: 'Test Agent',
    description: '',
    tags: [],
    provider: 'openai',
    modelId: 'gpt-4',
    thinkingLevel: 'none',
    systemPrompt: {
      mode: 'manual',
      sections: [{ key: 'manual', label: 'Manual Prompt', content: 'You are a test agent.', tokenEstimate: 6 }],
      assembled: 'You are a test agent.',
      userInstructions: 'You are a test agent.',
    },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: {
      label: 'Storage',
      backendType: 'filesystem',
      storagePath: '/tmp/test',
      sessionRetention: 50,
      memoryEnabled: false,
      dailyMemoryEnabled: false,
    },
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    runTimeoutMs: 172800000,
    ...overrides,
  };
}

describe('AgentManager', () => {
  let manager: AgentManager;
  let apiKeys: ApiKeyStore;

  beforeEach(() => {
    apiKeys = new ApiKeyStore();
    apiKeys.setAll({ openai: 'sk-test' });
    manager = new AgentManager(apiKeys);
  });

  it('starts an agent and tracks it', async () => {
    await manager.start(makeConfig());
    expect(manager.has('agent-1')).toBe(true);
  });

  it('destroys an agent', async () => {
    await manager.start(makeConfig());
    manager.destroy('agent-1');
    expect(manager.has('agent-1')).toBe(false);
  });

  it('replaces an existing agent on re-start', async () => {
    await manager.start(makeConfig());
    await manager.start(makeConfig({
      systemPrompt: {
        mode: 'manual',
        sections: [{ key: 'manual', label: 'Manual Prompt', content: 'Updated prompt', tokenEstimate: 3 }],
        assembled: 'Updated prompt',
        userInstructions: 'Updated prompt',
      },
    }));
    expect(manager.has('agent-1')).toBe(true);
  });

  it('shutdown destroys all agents', async () => {
    await manager.start(makeConfig());
    await manager.start(makeConfig({ id: 'agent-2', name: 'Agent 2' }));
    await manager.shutdown();
    expect(manager.has('agent-1')).toBe(false);
    expect(manager.has('agent-2')).toBe(false);
  });

  describe('dispatch facade', () => {
    it('dispatches a run and returns runId and sessionId', async () => {
      await manager.start(makeConfig());
      const result = await manager.dispatch('agent-1', {
        sessionKey: 'test-session',
        text: 'Hello',
      });

      expect(result.runId).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.acceptedAt).toBeDefined();
    });

    it('throws for unknown agent', async () => {
      await expect(
        manager.dispatch('unknown', { sessionKey: 's', text: 'Hello' })
      ).rejects.toThrow(/not found/i);
    });

    it('wait returns run result', async () => {
      await manager.start(makeConfig());
      const { runId } = await manager.dispatch('agent-1', {
        sessionKey: 'wait-test',
        text: 'Hello',
      });

      const result = await manager.wait('agent-1', runId, 5000);
      expect(result.status).toBe('ok');
      expect(result.runId).toBe(runId);
    });

    it('abortRun aborts a specific run', async () => {
      await manager.start(makeConfig());

      // Make prompt hang
      const runtime = (manager as any).agents.get('agent-1').runtime;
      runtime.prompt.mockImplementation(() => new Promise(() => {}));

      const { runId } = await manager.dispatch('agent-1', {
        sessionKey: 'abort-test',
        text: 'Hello',
      });

      await new Promise((r) => setTimeout(r, 10));
      manager.abortRun('agent-1', runId);

      const result = await manager.wait('agent-1', runId, 5000);
      expect(result.status).toBe('error');
      expect(result.error?.code).toBe('aborted');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/agents/agent-manager.test.ts`
Expected: FAIL — `dispatch`, `wait`, `abortRun` don't exist on AgentManager. `start` is sync but tests call `await`.

- [ ] **Step 3: Update `AgentManager`**

Rewrite `server/agents/agent-manager.ts`:

```typescript
import { AgentRuntime, type RuntimeEvent } from '../runtime/agent-runtime';
import { RunCoordinator } from './run-coordinator';
import { EventBridge } from './event-bridge';
import { StorageEngine } from '../runtime/storage-engine';
import type { ApiKeyStore } from '../auth/api-keys';
import type { AgentConfig } from '../../shared/agent-config';
import type {
  DispatchParams,
  DispatchResult,
  WaitResult,
  RunEventListener,
} from '../../shared/run-types';
import type WebSocket from 'ws';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface ManagedAgent {
  runtime: AgentRuntime;
  coordinator: RunCoordinator;
  config: AgentConfig;
  bridge: EventBridge;
  storage: StorageEngine | null;
  lastActivity: number;
  unsubscribe: () => void;
}

export class AgentManager {
  private agents = new Map<string, ManagedAgent>();

  constructor(private readonly apiKeys: ApiKeyStore) {}

  async start(config: AgentConfig): Promise<void> {
    // Destroy existing if present
    if (this.agents.has(config.id)) {
      this.destroy(config.id);
    }

    // Create StorageEngine if storage config exists
    let storage: StorageEngine | null = null;
    if (config.storage) {
      storage = new StorageEngine(config.storage, config.name);
      await storage.init();
    }

    const runtime = new AgentRuntime(
      config,
      (provider) => Promise.resolve(this.apiKeys.get(provider)),
    );

    const coordinator = new RunCoordinator(config.id, runtime, config, storage);

    const bridge = new EventBridge(config.id, coordinator);

    // Subscribe to coordinator lifecycle events for lastActivity tracking
    const unsubscribe = coordinator.subscribeAll(() => {
      const managed = this.agents.get(config.id);
      if (managed) managed.lastActivity = Date.now();
    });

    this.agents.set(config.id, {
      runtime,
      coordinator,
      config,
      bridge,
      storage,
      lastActivity: Date.now(),
      unsubscribe,
    });

    // Persist config for restart resilience
    this.persistConfig(config).catch(console.error);
  }

  async dispatch(agentId: string, params: DispatchParams): Promise<DispatchResult> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);
    managed.lastActivity = Date.now();
    return managed.coordinator.dispatch(params);
  }

  async wait(agentId: string, runId: string, timeoutMs?: number): Promise<WaitResult> {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);
    return managed.coordinator.wait(runId, timeoutMs);
  }

  subscribe(agentId: string, runId: string, listener: RunEventListener): () => void {
    const managed = this.agents.get(agentId);
    if (!managed) throw new Error(`Agent ${agentId} not found`);
    return managed.coordinator.subscribe(runId, listener);
  }

  abortRun(agentId: string, runId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.coordinator.abort(runId);
  }

  /** Abort the most recent active run, or a specific run by ID. */
  abort(agentId: string, runId?: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    const targetRunId = runId ?? managed.coordinator.getLatestActiveRunId();
    if (targetRunId) {
      managed.coordinator.abort(targetRunId);
    }
  }

  destroy(agentId: string): void {
    const managed = this.agents.get(agentId);
    if (!managed) return;
    managed.unsubscribe();
    managed.coordinator.destroy();
    managed.runtime.destroy();
    this.agents.delete(agentId);
  }

  has(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /** Returns the agent's overall status based on active runs. */
  getStatus(agentId: string): 'idle' | 'running' | 'error' | 'not_found' {
    const managed = this.agents.get(agentId);
    if (!managed) return 'not_found';
    const activeRun = managed.coordinator.getLatestActiveRunId();
    return activeRun ? 'running' : 'idle';
  }

  getBridge(agentId: string): EventBridge | undefined {
    return this.agents.get(agentId)?.bridge;
  }

  addSocket(agentId: string, socket: WebSocket): void {
    this.agents.get(agentId)?.bridge.addSocket(socket);
  }

  removeSocketFromAll(socket: WebSocket): void {
    for (const managed of this.agents.values()) {
      managed.bridge.removeSocket(socket);
    }
  }

  /** Persist agent config to disk for restart resilience. */
  private async persistConfig(config: AgentConfig): Promise<void> {
    if (!config.storage) return;
    const storagePath = config.storage.storagePath.startsWith('~')
      ? config.storage.storagePath.replace('~', os.homedir())
      : config.storage.storagePath;
    const agentDir = path.join(storagePath, config.name);
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(
      path.join(agentDir, 'agent-config.json'),
      JSON.stringify(config, null, 2),
      'utf-8',
    );
  }

  /** Restore agents from persisted configs on server boot. */
  async restoreFromDisk(storagePath: string): Promise<number> {
    const resolvedPath = storagePath.startsWith('~')
      ? storagePath.replace('~', os.homedir())
      : storagePath;

    let restored = 0;
    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const configPath = path.join(resolvedPath, entry.name, 'agent-config.json');
        try {
          const raw = await fs.readFile(configPath, 'utf-8');
          const config = JSON.parse(raw) as AgentConfig;
          await this.start(config);
          restored++;
        } catch {
          // No config file in this directory — skip
        }
      }
    } catch {
      // Storage path doesn't exist yet — nothing to restore
    }
    return restored;
  }

  /** Graceful shutdown: destroy all agents. */
  async shutdown(): Promise<void> {
    for (const [agentId] of this.agents) {
      this.destroy(agentId);
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/agents/agent-manager.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/agent-manager.ts server/agents/agent-manager.test.ts
git commit -m "feat: update AgentManager with dispatch/wait/subscribe facade via RunCoordinator"
```

---

### Task 8: Update `EventBridge` — Subscribe to Coordinator

**Files:**
- Modify: `server/agents/event-bridge.ts`
- Modify: `server/agents/event-bridge.test.ts`

- [ ] **Step 1: Write failing tests for the new EventBridge**

Replace `server/agents/event-bridge.test.ts` with:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventBridge } from './event-bridge';
import type { RunCoordinator } from './run-coordinator';
import type { ServerEvent } from '../../shared/protocol';
import type { CoordinatorEvent } from '../../shared/run-types';

function mockSocket() {
  return {
    readyState: 1,
    send: vi.fn(),
    OPEN: 1,
  } as any;
}

function mockCoordinator(): RunCoordinator & { _listeners: Set<(e: CoordinatorEvent) => void> } {
  const listeners = new Set<(e: CoordinatorEvent) => void>();
  return {
    _listeners: listeners,
    subscribeAll: vi.fn((listener: (e: CoordinatorEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as any;
}

function emitCoordinatorEvent(
  coordinator: ReturnType<typeof mockCoordinator>,
  event: CoordinatorEvent,
) {
  for (const listener of coordinator._listeners) {
    listener(event);
  }
}

describe('EventBridge (coordinator-based)', () => {
  it('maps lifecycle:start to lifecycle:start server event', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('lifecycle:start');
    expect(sent.runId).toBe('run-1');
    expect(sent.agentId).toBe('agent-1');
  });

  it('maps lifecycle:end to both lifecycle:end and agent:end (backwards compat)', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'lifecycle:end',
      runId: 'run-1',
      status: 'ok',
      startedAt: 1000,
      endedAt: 2000,
      payloads: [{ type: 'text', content: 'Hello' }],
    });

    expect(socket.send).toHaveBeenCalledTimes(2);
    const events = socket.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    expect(events.find((e: any) => e.type === 'lifecycle:end')).toBeDefined();
    expect(events.find((e: any) => e.type === 'agent:end')).toBeDefined();
  });

  it('maps lifecycle:error to both lifecycle:error and agent:error (backwards compat)', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'lifecycle:error',
      runId: 'run-1',
      status: 'error',
      error: { code: 'internal', message: 'Something failed', retriable: false },
      startedAt: 1000,
      endedAt: 2000,
    });

    expect(socket.send).toHaveBeenCalledTimes(2);
    const events = socket.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    expect(events.find((e: any) => e.type === 'lifecycle:error')).toBeDefined();
    const agentError = events.find((e: any) => e.type === 'agent:error');
    expect(agentError).toBeDefined();
    expect(agentError.error).toBe('Something failed');
  });

  it('maps stream text_delta events with runId', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      } as any,
    });

    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('message:delta');
    expect(sent.delta).toBe('hello');
    expect(sent.runId).toBe('run-1');
  });

  it('does not send to closed sockets', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    socket.readyState = 3;
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    expect(socket.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/agents/event-bridge.test.ts`
Expected: FAIL — EventBridge constructor doesn't accept a coordinator.

- [ ] **Step 3: Rewrite `EventBridge`**

Replace `server/agents/event-bridge.ts` with:

```typescript
import type WebSocket from 'ws';
import type { RunCoordinator } from './run-coordinator';
import type { CoordinatorEvent } from '../../shared/run-types';
import type { ServerEvent } from '../../shared/protocol';

/**
 * Bridges CoordinatorEvents from a RunCoordinator to connected WebSocket clients.
 * One EventBridge per managed agent.
 */
export class EventBridge {
  private sockets = new Set<WebSocket>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly agentId: string,
    coordinator: RunCoordinator,
  ) {
    this.unsubscribe = coordinator.subscribeAll((event) => {
      this.handleCoordinatorEvent(event);
    });
  }

  addSocket(socket: WebSocket): void {
    this.sockets.add(socket);
  }

  removeSocket(socket: WebSocket): void {
    this.sockets.delete(socket);
  }

  get socketCount(): number {
    return this.sockets.size;
  }

  destroy(): void {
    this.unsubscribe?.();
    this.sockets.clear();
  }

  private handleCoordinatorEvent(event: CoordinatorEvent): void {
    switch (event.type) {
      case 'lifecycle:start':
        this.broadcast({
          type: 'lifecycle:start',
          agentId: this.agentId,
          runId: event.runId,
          sessionId: event.sessionId,
          startedAt: event.startedAt,
        } as any);
        break;

      case 'lifecycle:end':
        this.broadcast({
          type: 'lifecycle:end',
          agentId: this.agentId,
          runId: event.runId,
          status: 'ok',
          startedAt: event.startedAt,
          endedAt: event.endedAt,
          payloads: event.payloads,
          usage: event.usage,
        } as any);
        // Backwards compat
        this.broadcast({ type: 'agent:end', agentId: this.agentId });
        break;

      case 'lifecycle:error':
        this.broadcast({
          type: 'lifecycle:error',
          agentId: this.agentId,
          runId: event.runId,
          status: 'error',
          error: event.error,
          startedAt: event.startedAt,
          endedAt: event.endedAt,
        } as any);
        // Backwards compat
        this.broadcast({
          type: 'agent:error',
          agentId: this.agentId,
          error: event.error.message,
        });
        break;

      case 'stream':
        this.handleStreamEvent(event.runId, event.event);
        break;
    }
  }

  private handleStreamEvent(runId: string, event: unknown): void {
    const e = event as any;
    const agentId = this.agentId;

    switch (e.type) {
      case 'message_start': {
        const msg = e.message as { role?: string };
        if (msg.role === 'assistant') {
          this.broadcast({ type: 'message:start', agentId, runId, message: { role: 'assistant' } } as any);
        }
        break;
      }

      case 'message_update': {
        const aEvent = e.assistantMessageEvent;
        if (aEvent.type === 'text_delta') {
          this.broadcast({ type: 'message:delta', agentId, runId, delta: aEvent.delta } as any);
        }
        if (aEvent.type === 'error') {
          this.broadcast({
            type: 'agent:error',
            agentId,
            error: aEvent.error?.errorMessage || 'Unknown provider error',
          });
        }
        break;
      }

      case 'message_end': {
        const endMsg = e.message as { role?: string; usage?: any };
        if (endMsg.role === 'assistant') {
          this.broadcast({
            type: 'message:end',
            agentId,
            runId,
            message: { role: 'assistant', usage: endMsg.usage },
          } as any);
        }
        break;
      }

      case 'tool_execution_start':
        this.broadcast({
          type: 'tool:start',
          agentId,
          runId,
          toolCallId: e.toolCallId,
          toolName: e.toolName,
        } as any);
        break;

      case 'tool_execution_end': {
        const resultText = e.result?.content
          ?.map((c: { type: string; text?: string }) => c.type === 'text' ? c.text : '')
          .join('') || '';
        this.broadcast({
          type: 'tool:end',
          agentId,
          runId,
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          result: resultText.slice(0, 500),
          isError: !!e.isError,
        } as any);
        break;
      }
    }
  }

  private broadcast(event: ServerEvent): void {
    const json = JSON.stringify(event);
    for (const socket of this.sockets) {
      if (socket.readyState === (socket as any).OPEN) {
        socket.send(json);
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/agents/event-bridge.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/event-bridge.ts server/agents/event-bridge.test.ts
git commit -m "feat: rewrite EventBridge to consume RunCoordinator events with backwards compat"
```

---

### Task 9: Update `ws-handler` — New Commands

**Files:**
- Modify: `server/connections/ws-handler.ts`

- [ ] **Step 1: Update the ws-handler to support new commands**

Replace `server/connections/ws-handler.ts` with:

```typescript
import type WebSocket from 'ws';
import type { AgentManager } from '../agents/agent-manager';
import type { ApiKeyStore } from '../auth/api-keys';
import type { Command, AgentStateEvent } from '../../shared/protocol';

/**
 * Handles a single WebSocket connection: parses incoming commands,
 * routes them to AgentManager, manages socket lifecycle.
 */
export function handleConnection(
  socket: WebSocket,
  manager: AgentManager,
  apiKeys: ApiKeyStore,
): void {
  console.log('[ws] Client connected');

  socket.on('message', async (data) => {
    let command: Command;
    try {
      command = JSON.parse(data.toString()) as Command;
      console.log(`[ws] Received command: ${command.type}`, 'agentId' in command ? `(Agent: ${command.agentId})` : '');
    } catch {
      socket.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
      return;
    }

    try {
      switch (command.type) {
        case 'agent:start': {
          await manager.start(command.config);
          manager.addSocket(command.agentId, socket);
          socket.send(JSON.stringify({
            type: 'agent:ready',
            agentId: command.agentId,
          }));
          break;
        }

        case 'agent:dispatch': {
          manager.addSocket(command.agentId, socket);
          const result = await manager.dispatch(command.agentId, {
            sessionKey: command.sessionKey,
            text: command.text,
            attachments: command.attachments,
          });
          // Send run:accepted acknowledgment
          socket.send(JSON.stringify({
            type: 'run:accepted',
            agentId: command.agentId,
            runId: result.runId,
            sessionId: result.sessionId,
            acceptedAt: result.acceptedAt,
          }));
          break;
        }

        case 'agent:prompt': {
          // Backwards compat: translate to dispatch
          manager.addSocket(command.agentId, socket);
          const result = await manager.dispatch(command.agentId, {
            sessionKey: command.sessionId,  // use sessionId as sessionKey
            text: command.text,
            attachments: command.attachments,
          });
          socket.send(JSON.stringify({
            type: 'run:accepted',
            agentId: command.agentId,
            runId: result.runId,
            sessionId: result.sessionId,
            acceptedAt: result.acceptedAt,
          }));
          break;
        }

        case 'run:wait': {
          const waitResult = await manager.wait(command.agentId, command.runId, command.timeoutMs);
          socket.send(JSON.stringify({
            type: waitResult.status === 'ok' ? 'lifecycle:end' : 'lifecycle:error',
            agentId: command.agentId,
            ...waitResult,
          }));
          break;
        }

        case 'agent:abort': {
          manager.abort(command.agentId, command.runId);
          break;
        }

        case 'agent:destroy': {
          manager.destroy(command.agentId);
          break;
        }

        case 'agent:sync': {
          manager.addSocket(command.agentId, socket);
          const stateEvent: AgentStateEvent = {
            type: 'agent:state',
            agentId: command.agentId,
            status: manager.getStatus(command.agentId),
            messages: [],
          };
          socket.send(JSON.stringify(stateEvent));
          break;
        }

        case 'config:setApiKeys': {
          apiKeys.setAll(command.keys);
          break;
        }
      }
    } catch (err) {
      socket.send(JSON.stringify({
        type: 'agent:error',
        agentId: (command as any).agentId ?? 'unknown',
        error: err instanceof Error ? err.message : 'Unknown error',
      }));
    }
  });

  socket.on('close', () => {
    console.log('[ws] Client disconnected');
    manager.removeSocketFromAll(socket);
  });

  socket.on('error', (err) => {
    console.error('[ws] Socket error:', err.message);
    manager.removeSocketFromAll(socket);
  });
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add server/connections/ws-handler.ts
git commit -m "feat: update ws-handler with agent:dispatch, run:wait, and backwards-compat agent:prompt"
```

---

### Task 10: Integration Test — Full Dispatch-Wait Cycle

**Files:**
- Modify: `server/agents/run-coordinator.test.ts` (add integration test)

- [ ] **Step 1: Add a full cycle integration test**

Append to `server/agents/run-coordinator.test.ts`:

```typescript
describe('integration: full dispatch-wait cycle', () => {
  it('dispatches, streams events, waits, and returns payloads', async () => {
    // Make runtime emit realistic events
    (runtime.subscribe as any).mockImplementation((listener: any) => {
      // Will be called during executeRun
      // Events are emitted by the real subscribe call
      return () => {};
    });

    const allEvents: any[] = [];
    coordinator.subscribeAll((event) => allEvents.push(event));

    const { runId } = await coordinator.dispatch({ sessionKey: 'full-cycle', text: 'Hello' });

    const result = await coordinator.wait(runId, 5000);

    expect(result.status).toBe('ok');
    expect(result.runId).toBe(runId);

    // Verify lifecycle events were emitted
    const lifecycleStart = allEvents.find((e) => e.type === 'lifecycle:start');
    expect(lifecycleStart).toBeDefined();
    expect(lifecycleStart.runId).toBe(runId);

    const lifecycleEnd = allEvents.find((e) => e.type === 'lifecycle:end');
    expect(lifecycleEnd).toBeDefined();
    expect(lifecycleEnd.runId).toBe(runId);
    expect(lifecycleEnd.status).toBe('ok');
  });

  it('session is reusable after a run completes', async () => {
    const { runId: run1 } = await coordinator.dispatch({ sessionKey: 'reuse', text: 'First' });
    await coordinator.wait(run1, 5000);

    // Same session key should work again
    const { runId: run2 } = await coordinator.dispatch({ sessionKey: 'reuse', text: 'Second' });
    await coordinator.wait(run2, 5000);

    expect(run1).not.toBe(run2);

    const result = await coordinator.wait(run2, 100);
    expect(result.status).toBe('ok');
  });

  it('classifyError maps rate limit errors correctly', async () => {
    (runtime.prompt as any).mockRejectedValueOnce(new Error('Rate limit exceeded (429)'));

    const { runId } = await coordinator.dispatch({ sessionKey: 'rate-limit', text: 'Hello' });
    const result = await coordinator.wait(runId, 5000);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('rate_limited');
    expect(result.error?.retriable).toBe(true);
  });
});
```

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run server/agents/run-coordinator.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Run all server tests to verify nothing is broken**

Run: `npx vitest run server/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/agents/run-coordinator.test.ts
git commit -m "test: add integration tests for full dispatch-wait lifecycle"
```

---

### Task 11: Verify Full Build and All Tests

**Files:** None (verification only)

- [ ] **Step 1: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: No type errors. If there are errors, fix them before proceeding.

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 3: Fix any failures**

If any tests fail, fix them. Common issues:
- Existing tests that use `manager.prompt()` directly — update them to use `manager.dispatch()` + `manager.wait()`
- Existing tests that check `manager.getStatus()` returning `'idle'` — the method may need updating since status is now per-run
- Type mismatches from `sessionKey` being optional on `SessionMeta` — existing test data may need the field added

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix: resolve build and test issues from run lifecycle integration"
```
