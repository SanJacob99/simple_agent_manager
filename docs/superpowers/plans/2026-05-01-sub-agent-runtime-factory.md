# Sub-Agent Runtime Factory — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `RunCoordinator.runChild` stub so sub-agents actually execute. The schema, registry, REST surface, executor, override validation, abort plumbing, transcript persistence wiring, and UI all already work end-to-end and were verified live in the browser — the *only* missing link is constructing an `AgentRuntime` for the child and driving a single turn through it.

**Approach:** Inject a runtime factory into `RunCoordinator`. The factory is owned by `AgentManager` (which already has the dependencies the runtime needs: `apiKeys`, `pluginRegistry`, `hitlRegistry`, `safetySettings`). `runChild` uses the factory, opens the sub-session transcript, drives one `runtime.prompt()` turn, captures the assistant text from the event stream, persists, and tears down.

**Tech Stack:** TypeScript, vitest, existing `RunCoordinator` / `AgentRuntime` / `SubAgentExecutor` / `SubAgentRegistry` / `SessionRouter` / `SessionTranscriptStore`.

**Background:**
- The end-to-end browser test (Apr 30 / May 1) drove the parent agent through a real `sessions_spawn` call. The model received a valid `subAgentId`, the registry sealed the record with the stub error message, and `POST /kill` correctly returned 409 on the terminal record. **Every layer above `runChild` is operational.**
- The current stub at [server/agents/run-coordinator.ts:780](../../../server/agents/run-coordinator.ts#L780) returns `{ status: 'error', error: 'Sub-agent runtime dispatch is not yet integrated…' }`. It already wires the `AbortController` correctly so callers see the abort path.

**Convention decisions locked by this plan:**

- **Factory injection over manager export.** `RunCoordinator` accepts an optional `runtimeFactory: (config) => AgentRuntime` in its constructor; `AgentManager.start()` passes one. Tests inject mocks. We do not couple `RunCoordinator` to `AgentManager`.
- **Reuse parent `HookRegistry` for child runs.** Child sub-agents fire the same `before_model_resolve` / `tool_*` hooks as the parent. Per-spawn HookRegistry construction (rebuilding from `syntheticConfig.tools.plugins`) is a follow-up — when a sub has dedicated MCP/Skills nodes its plugin set can diverge.
- **Reuse parent `StorageEngine`.** Sub-sessions live alongside parent sessions on disk; the `sub:` prefix on the session key namespaces them. Sub-agents do not get a dedicated storage backend in v1.
- **One runtime per spawn, destroyed when the run resolves.** No reuse across spawns. Sub-agent runs are short, one-shot, and the registry already enforces sealing.
- **Sub-session entries are upserted by the runChild path.** Today `sessions_spawn` calls `persistSubAgentMeta()` *before* dispatch; that function must tolerate an entry not existing yet and create one. Verifying / fixing that is part of this plan.
- **Concurrency: sub-agent runs do NOT enter `RunConcurrencyController.enqueue`.** They run alongside the parent without occupying its queue slot, just like the executor was designed for. The parent stays free to keep streaming while children execute.
- **Recursive sub-agent spawns stay disabled.** Even if a sub's `recursiveSubAgentsEnabled` flag is true, the child runtime is constructed without `subAgents` injected into its tool surface in v1. Document; ramp later.

---

## File Structure

### New
| File | Responsibility |
|---|---|
| `server/agents/runtime-factory.ts` | Tiny shared type alias for the factory function (kept separate so it can be re-exported without circular imports) |

### Modified
| File | Change |
|---|---|
| `server/agents/agent-manager.ts` | Extract per-runtime construction into private `buildRuntime(config)` reused by both `start()` and the factory passed to `RunCoordinator` |
| `server/agents/run-coordinator.ts` | New optional constructor parameter `runtimeFactory`; rewrite `runChild` body to actually drive the child runtime end-to-end |
| `server/agents/run-coordinator.test.ts` | New cases: child runs to completion via mock factory, abort tears down the child runtime, missing factory falls back to a structured error |
| `server/sessions/session-tools.ts` | Verify (and fix if needed) that `persistSubAgentMeta` upserts when the entry doesn't yet exist |
| `server/agents/sub-agent-integration.test.ts` | Add a case that exercises the *real* `runChild` path through a mock factory and asserts the registry transitions `running → completed` with text |
| `scripts/verify-subagents.ts` | New section that exercises the runtime-factory branch with an in-memory mock |

---

## Task 1: Extract `runtime-factory.ts` shared type

**Files:**
- Create: `server/agents/runtime-factory.ts`

- [ ] **Step 1.1: Create the type alias module**

```typescript
// server/agents/runtime-factory.ts
import type { AgentConfig } from '../../shared/agent-config';
import type { AgentRuntime } from '../runtime/agent-runtime';

/**
 * Build a fresh AgentRuntime from a (potentially synthetic) AgentConfig.
 * Owned by AgentManager — passed into RunCoordinator so child sub-agent
 * runs can construct their own per-spawn runtime without coupling
 * RunCoordinator to AgentManager directly. Tests inject mocks.
 */
export type RuntimeFactory = (config: AgentConfig) => AgentRuntime;
```

- [ ] **Step 1.2: Verify** — `npx tsc -p tsconfig.server.json --noEmit` (no new errors).

---

## Task 2: Add `buildRuntime` factory to `AgentManager`

**Files:**
- Modify: `server/agents/agent-manager.ts`

- [ ] **Step 2.1: Extract the existing inline runtime construction in `AgentManager.start()` into a private method.**

The current `start()` body at [server/agents/agent-manager.ts:101-110](../../../server/agents/agent-manager.ts#L101-L110) inlines:

```typescript
const runtime = new AgentRuntime(
  config,
  (provider) => Promise.resolve(this.apiKeys.get(provider)),
  undefined,
  hooks,
  this.pluginRegistry,
  this.hitlRegistry,
  this.getSafetySettings(),
);
```

Extract to:

```typescript
private buildRuntime(config: AgentConfig, hooks: HookRegistry): AgentRuntime {
  return new AgentRuntime(
    config,
    (provider) => Promise.resolve(this.apiKeys.get(provider)),
    undefined,
    hooks,
    this.pluginRegistry,
    this.hitlRegistry,
    this.getSafetySettings(),
  );
}
```

- [ ] **Step 2.2: Have `start()` call `buildRuntime(config, hooks)` instead of constructing inline.**

- [ ] **Step 2.3: Pass a factory closure into `RunCoordinator`'s constructor.**

The factory reuses the parent's `HookRegistry`. This means child runs fire the same hooks the parent has registered:

```typescript
const coordinator = new RunCoordinator(
  config.id,
  runtime,
  config,
  storage,
  hooks,
  /* sessionRouter */ undefined,
  /* transcriptStore */ undefined,
  /* runtimeFactory */ (childConfig) => this.buildRuntime(childConfig, hooks),
);
```

- [ ] **Step 2.4: Verify** — `npx tsc -p tsconfig.server.json --noEmit` and `npx vitest run server/agents/agent-manager.test.ts` (existing tests must still pass — the factory is wired but not yet consumed by `runChild`).

---

## Task 3: Add `runtimeFactory` parameter to `RunCoordinator`

**Files:**
- Modify: `server/agents/run-coordinator.ts`

- [ ] **Step 3.1: Import the type alias.**

```typescript
import type { RuntimeFactory } from './runtime-factory';
```

- [ ] **Step 3.2: Add an optional positional parameter to the constructor**, after `transcriptStore`. New signature:

```typescript
constructor(
  private readonly agentId: string,
  private readonly runtime: AgentRuntime,
  private readonly config: AgentConfig,
  private readonly storage: StorageEngine | null,
  private readonly hooks: HookRegistry | null = null,
  sessionRouter?: SessionRouter,
  transcriptStore?: SessionTranscriptStore,
  private readonly runtimeFactory?: RuntimeFactory,   // ← new
) { ... }
```

Optional so existing tests (`run-coordinator.test.ts`, fixtures) don't have to be retrofitted; they'll still hit the structured-error fallback below.

- [ ] **Step 3.3: Verify** — `npx tsc -p tsconfig.server.json --noEmit` (no new errors; existing call sites still type-check because the parameter is optional).

---

## Task 4: Verify `persistSubAgentMeta` upsert semantics

**Files:**
- Investigate: `server/sessions/session-tools.ts`, callers in `server/agents/run-coordinator.ts`
- Modify (if needed): `server/agents/run-coordinator.ts` (the closure passed in `SessionToolContext`)
- Add test: `server/sessions/session-tools.test.ts` or a new isolated test for the upsert path

**Background:** `sessions_spawn` calls `persistSubAgentMeta(subSessionKey, meta)` *before* dispatch starts. If the entry doesn't exist, the meta write must create it (otherwise the row is silently dropped and the sub-session is invisible to `getSession`). Sub-session entry creation today is implicit in `sessions_spawn`; the upsert behavior was flagged as a follow-up at the end of the prior plan.

- [ ] **Step 4.1: Add a unit test** that calls `persistSubAgentMeta` against a clean storage with no pre-existing entry for the sub-session key, then reads back via `storage.getSession(key)` and asserts the entry exists with the meta populated.

- [ ] **Step 4.2: If the test fails**, change the closure (in run-coordinator.ts where `persistSubAgentMeta` is wired into `SessionToolContext`) to upsert: read existing entry → merge `subAgentMeta` field → write back; if missing, construct a minimal `SessionStoreEntry` with `chatType: 'sub'`, the parent's storage backend, and the meta populated.

- [ ] **Step 4.3: Verify** — the new test passes; existing session-tools tests still pass.

---

## Task 5: Implement `runChild` body

**Files:**
- Modify: `server/agents/run-coordinator.ts` (replace the stub at line ~780)

- [ ] **Step 5.1: Replace the stub.** Pseudocode (real implementation must handle every error path):

```typescript
private async runChild(opts: ChildRunOptions): Promise<ChildRunResult> {
  if (!this.runtimeFactory) {
    return {
      status: 'error',
      error: 'No runtime factory wired into RunCoordinator; sub-agents cannot run.',
    };
  }
  if (!this.storage || !this.transcriptStore || !this.sessionRouter) {
    return {
      status: 'error',
      error: 'Sub-agent runs require storage / transcript / router; none are configured.',
    };
  }

  const abortController = new AbortController();
  let aborted = false;
  opts.onAbort = () => {
    aborted = true;
    abortController.abort();
  };
  if (abortController.signal.aborted) return { status: 'aborted' };

  // 1. Resolve sub-session entry → transcript path. Task 4 ensures the
  //    entry exists by the time runChild is called (persistSubAgentMeta
  //    upserts at spawn time).
  const entry = await this.storage.getSession(opts.sessionKey);
  if (!entry) {
    return {
      status: 'error',
      error: `Sub-session entry not found for ${opts.sessionKey}; spawn metadata write may have failed.`,
    };
  }
  const transcriptPath = this.storage.resolveTranscriptPath(entry);
  const transcriptManager = this.transcriptStore.openSession(transcriptPath);

  // 2. Build per-spawn runtime.
  const childRuntime = this.runtimeFactory(opts.syntheticConfig);
  childRuntime.setActiveSession(transcriptManager);
  childRuntime.setCurrentSessionKey(opts.sessionKey);
  childRuntime.setSessionContext(
    transcriptManager.buildSessionContext().messages as AgentMessage[],
  );

  // 3. Forward runtime events to the executor's emit (which tags with
  //    childRunId before forwarding to the parent's event bus).
  let assistantText = '';
  const unsub = childRuntime.subscribe((event) => {
    // Capture assistant text from message_end. This is the same path
    // executeRun uses for the parent.
    if (
      event.type === 'message_end' &&
      (event as any).message?.role === 'assistant'
    ) {
      assistantText = extractTextContent((event as any).message.content);
    }
    opts.emit(event as any);
  });

  // 4. Wire abort to childRuntime teardown.
  if (abortController.signal.aborted) {
    unsub();
    childRuntime.destroy();
    return { status: 'aborted' };
  }

  try {
    // 5. Drive one turn.
    await childRuntime.prompt(opts.message);
    if (aborted) return { status: 'aborted' };

    // 6. Persist transcript writes (transcriptManager batches them).
    await transcriptManager.flush?.();

    return { status: 'completed', text: assistantText };
  } catch (err) {
    if (aborted) return { status: 'aborted' };
    return {
      status: 'error',
      error: err instanceof Error ? err.message : 'Sub-agent run threw an unknown error',
    };
  } finally {
    unsub();
    childRuntime.destroy();
  }
}
```

- [ ] **Step 5.2: Confirm `transcriptManager.flush` exists** by reading `SessionTranscriptStore.openSession`'s return type. If it doesn't, drop the explicit flush — pi-coding-agent's `SessionManager` writes synchronously on `addMessage`. (Likely no-op step but worth confirming.)

- [ ] **Step 5.3: Confirm `childRuntime.subscribe` exposes a runtime-level event subscriber** with the same `RuntimeEventListener` signature `executeRun` uses. Find it in agent-runtime.ts. (We rely on it for capturing `message_end`.)

- [ ] **Step 5.4: Confirm `childRuntime.destroy()` exists.** Yes — it's called in `AgentManager.destroy()` at [agent-manager.ts:217](../../../server/agents/agent-manager.ts#L217), so it's a real method.

- [ ] **Step 5.5: Verify** — `npx tsc -p tsconfig.server.json --noEmit` clean; existing tests still pass.

---

## Task 6: Tests for the new runChild path

**Files:**
- Modify: `server/agents/run-coordinator.test.ts`
- Modify: `server/agents/sub-agent-integration.test.ts`

- [ ] **Step 6.1: Add a unit test** that constructs a `RunCoordinator` with a *mock* `runtimeFactory` returning a stub runtime whose `prompt()` emits a synthetic `message_end` with assistant text and resolves. Drive `runChild` directly via the executor; assert:
  - registry record transitions `running → completed` with the captured text
  - the executor's `emit` callback received the events

- [ ] **Step 6.2: Add a unit test** for abort: factory returns a runtime whose `prompt()` never resolves; trigger `coordinator.abort(childRunId)`; assert:
  - the runtime's destroy was called
  - the registry status is `'killed'` (kill path) or `'aborted'` (cooperative abort)
  - the dispatch promise resolves with `{ status: 'aborted' }`

- [ ] **Step 6.3: Add a unit test** for missing factory: construct a `RunCoordinator` *without* a `runtimeFactory`; dispatch a sub-agent spawn; assert the dispatch resolves with `{ status: 'error', error: /no runtime factory/i }` and the registry transitions to `'error'`.

- [ ] **Step 6.4: Update `sub-agent-integration.test.ts`** to use the mock factory and assert the spawn-to-completion path end-to-end. Keep the existing kill case (it doesn't need a real runtime, just the abort plumbing).

---

## Task 7: Browser smoke test

**Files:**
- No code changes — manual run.

- [ ] **Step 7.1: Restart the dev server** (`npm run dev`) and reload [http://localhost:5174](http://localhost:5174).

- [ ] **Step 7.2: Open the parent agent's chat**, start a new session, prompt: *"Spawn a sub agent named researcher with message 'reply with the word DONE_SUB' and wait=true. Tell me what the sub-agent returned."*

- [ ] **Step 7.3: Approve the HITL `confirm_action` prompt.**

- [ ] **Step 7.4: Expected:** the model returns the sub-agent's actual reply (`DONE_SUB`) inline, not the runtime-stub error. The sub-agent's record at `GET /api/subagents/:id` shows `status: 'completed'`, `sealed: true`, and the sub-session transcript contains both the user message and the assistant reply.

- [ ] **Step 7.5: Repeat with `wait=false`** to confirm the non-blocking path: the parent gets back the `subAgentId` immediately, polling `/api/subagents/:id` shows `status: 'running'` then `'completed'` once the child finishes.

- [ ] **Step 7.6: Repeat with abort:** prompt the parent to spawn, then call `POST /api/subagents/:id/kill` from the browser console while the child is still running; expect `status: 'killed'`, `sealed: true`, and a clean `aborted` result on the dispatch.

---

## Task 8: Update verification harness

**Files:**
- Modify: `scripts/verify-subagents.ts`

- [ ] **Step 8.1: Replace the disabled "runtime is stubbed" assertion** with a new section that wires a mock runtime factory through a real `RunCoordinator`, dispatches a sub-agent spawn end-to-end, and asserts the registry transitions to `'completed'` with the mock's reply text.

- [ ] **Step 8.2: Run `npx tsx scripts/verify-subagents.ts`** — every check passes.

---

## Risk Register

| Risk | Mitigation |
|---|---|
| Child runtime memory leak if `destroy()` isn't called on every path | The `try/finally` in runChild covers all exit paths including abort. Vitest test in 6.2 asserts the call. |
| HookRegistry sharing leaks plugin state across parent and child | Reuse-parent is intentional and documented above. Per-child registry construction is a follow-up. Plugin authors writing per-call state should already be using the `runId` to scope it (the existing convention for parent runs). |
| Sub-session entry doesn't exist when `runChild` opens the transcript | Task 4 verifies and fixes the upsert path. Without that fix, the existing browser test would have surfaced an error — but `wait=false` masks it because the spawn returns the id before runChild even runs. |
| Recursive sub-agents (sub spawns sub) loop without resource control | Sub's runtime is built without `sessions_spawn` injected into its tool surface in v1 — drop sub-agents from the synthetic AgentConfig before passing to the factory. (Add a one-line strip in runChild: `{ ...opts.syntheticConfig, subAgents: [] }`.) |
| Per-spawn runtime construction is slow (cold-start tools, plugins, MemoryEngine) | Acceptable for v1 — sub-agents are single-turn and short. Profile after we have real workloads; cache by hash of synthetic config if needed. |
| Sub-agent's MemoryEngine writes pollute parent's memory | Each runtime constructs its own `MemoryEngine` from `config.memory`. Since sub inherits parent's memory config but writes through its own engine instance, both engines target the same disk paths — they share. **Document for v1; add `subagent/` namespacing as a follow-up.** |

---

## Out of Scope (Follow-ups)

- Per-child `HookRegistry` reconstruction from `syntheticConfig.tools.plugins`.
- Cross-agent sub-agents (gated behind `coordinatorLookup` already).
- Recursive sub-agents (locked off in v1 by stripping `subAgents` from the child's synthetic config).
- Per-sub-agent memory namespacing.
- `findBySessionKey` wrapped-key handling (only matters if the runtime uses the wrapped form, which it doesn't).
- Performance: cached runtime per `syntheticConfig` hash.

---

## Success Criteria

- The browser smoke test in Task 7 returns the sub-agent's actual reply text in the parent's chat (not the stub error).
- `GET /api/subagents/:id` reports `status: 'completed'` for a successful spawn.
- `POST /api/subagents/:id/kill` while a child is running transitions the record to `'killed'` and the dispatch resolves `aborted`.
- All existing sub-agent tests (65/65) plus the new tests in Task 6 pass.
- Server typecheck has no *new* errors compared to the baseline.
