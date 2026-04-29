# Session Config Change Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist per-session model and thinking-level changes as discrete transcript events plus a run-time `model-snapshot` custom entry, with `SessionStoreEntry` kept as a mirrored cache for fast resume. Wire chat-drawer toggles through a new `session:set-config` WebSocket command.

**Architecture:** New method `SessionRouter.recordConfigChange(sessionKey, change)` is the single funnel for toggle-time writes — drops same-value, opens the transcript via `SessionTranscriptStore`, calls `appendModelChange` / `appendThinkingLevelChange`, then mirrors the value into `SessionStoreEntry`. New method `RunCoordinator.persistModelSnapshot(transcriptManager)` is called from `persistUserMessage` after `persistConfigChanges`; it reads the resolved `Model<Api>` from `AgentRuntime`, compares the `{provider, modelApi, modelId}` tuple with the most recent `model-snapshot` in the transcript, and appends a `custom` entry only on change. `persistConfigChanges` is extended to also write the mirrored fields. The chat drawer gets two new selectors that call a new client store action which sends `session:set-config` over the existing WebSocket.

**Tech Stack:** TypeScript, vitest, pi-coding-agent `SessionManager` (`appendModelChange`, `appendThinkingLevelChange`, `appendCustomEntry`), pi-ai `Model<Api>.api`, existing WebSocket protocol in `shared/protocol.ts`, React + Zustand stores on the client.

---

## Spec Reference

[docs/superpowers/specs/2026-04-28-session-config-change-events-design.md](../specs/2026-04-28-session-config-change-events-design.md)

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `shared/protocol.ts` | Add `SessionSetConfigCommand` to the `Command` union |
| Modify | `server/sessions/session-router.ts` | Add `recordConfigChange()` method |
| Create | `server/sessions/session-router.recordConfigChange.test.ts` | Cover all branches of the new method |
| Modify | `server/agents/agent-manager.ts` | Add `recordConfigChange()` that locates the right `SessionRouter` |
| Modify | `server/connections/ws-handler.ts` | Add `case 'session:set-config'` |
| Modify | `server/agents/run-coordinator.ts` | Add `persistModelSnapshot()`, mirror writes in `persistConfigChanges()`, call site in `persistUserMessage()` |
| Modify | `server/agents/run-coordinator.test.ts` | Cover snapshot write/idempotency and mirror updates |
| Modify | `server/runtime/agent-runtime.ts` | Expose `getResolvedModelApi()` so the coordinator can read `modelApi` without re-resolving |
| Modify | `server/runtime/agent-runtime.test.ts` | Cover the new getter |
| Modify | `src/store/agent-connection-store.ts` | Add `sendSessionSetConfig(agentId, sessionKey, change)` action |
| Modify | `src/store/agent-connection-store.test.ts` | Cover the new action |
| Modify | `src/chat/ChatDrawer.tsx` | Add model + thinking-level selectors above the input row |
| Modify | `src/chat/ChatDrawer.test.tsx` | Cover the new selectors fire `session:set-config` |

Out of scope (spec — Out of scope section): typed events for verbose/reasoning/sendPolicy/authProfile, a transcript-walking history UI, batched flushes, retroactive backfill.

---

## Task 1: Add `SessionSetConfigCommand` to the protocol

**Files:**
- Modify: [shared/protocol.ts](../../../shared/protocol.ts)

- [ ] **Step 1: Add the new command type**

In [shared/protocol.ts](../../../shared/protocol.ts), after the `HitlListCommand` interface (around line 64), add:

```typescript
/**
 * Per-session config change emitted from the chat drawer when the user
 * toggles a model or thinking level. Server records this as a discrete
 * transcript event and mirrors the value onto the SessionStoreEntry.
 *
 * Per-toggle, immediate write — buffering happens at the router level
 * via the same-value drop, not on the client.
 */
export type SessionConfigChange =
  | { kind: 'model'; provider: string; modelId: string }
  | { kind: 'thinking_level'; thinkingLevel: string };

export interface SessionSetConfigCommand {
  type: 'session:set-config';
  agentId: string;
  sessionKey: string;
  change: SessionConfigChange;
}
```

- [ ] **Step 2: Add it to the `Command` union**

Update the `Command` union at the bottom of the same block to include the new command:

```typescript
export type Command =
  | AgentStartCommand
  | AgentPromptCommand
  | AgentDispatchCommand
  | AgentAbortCommand
  | AgentDestroyCommand
  | AgentSyncCommand
  | RunWaitCommand
  | SetApiKeysCommand
  | HitlRespondCommand
  | HitlListCommand
  | SessionSetConfigCommand;
```

- [ ] **Step 3: Verify the protocol still type-checks**

Run: `npx tsc -p . --noEmit`
Expected: PASS (existing handlers will be exhaustively typed; if vitest's protocol tests warn about an unhandled case, fix in Task 4 — for now just check no compile errors).

- [ ] **Step 4: Commit**

```bash
git add shared/protocol.ts
git commit -m "feat(protocol): add session:set-config command for per-session config changes"
```

---

## Task 2: Implement `SessionRouter.recordConfigChange`

**Files:**
- Modify: [server/sessions/session-router.ts](../../../server/sessions/session-router.ts)
- Create: `server/sessions/session-router.recordConfigChange.test.ts`

- [ ] **Step 1: Write the failing test**

Create [server/sessions/session-router.recordConfigChange.test.ts](../../../server/sessions/session-router.recordConfigChange.test.ts):

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { StorageEngine } from '../storage/storage-engine';
import { SessionTranscriptStore } from './session-transcript-store';
import { SessionRouter } from './session-router';
import type { ResolvedStorageConfig } from '../../shared/agent-config';

let tmp: string;
let router: SessionRouter;
let store: SessionTranscriptStore;
let engine: StorageEngine;
let sessionKey: string;
let transcriptPath: string;

const config: ResolvedStorageConfig = {
  storagePath: '',
  agentId: 'agent-A',
  sessionRetention: 50,
  parentForkMaxTokens: 0,
  dailyResetEnabled: false,
  dailyResetHour: 0,
  idleResetEnabled: false,
  idleResetMinutes: 0,
};

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-rcc-'));
  const cfg: ResolvedStorageConfig = { ...config, storagePath: tmp };
  engine = new StorageEngine(cfg, 'agent-A');
  await engine.init();
  store = new SessionTranscriptStore(engine.getSessionsDir(), tmp);
  router = new SessionRouter(engine, store, cfg, 'agent-A');
  const routed = await router.route({ agentId: 'agent-A' });
  sessionKey = routed.sessionKey;
  transcriptPath = routed.transcriptPath;
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('SessionRouter.recordConfigChange', () => {
  it('writes a model_change entry and mirrors providerOverride/modelOverride', async () => {
    await router.recordConfigChange(sessionKey, {
      kind: 'model',
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4',
    });

    const entries = store.readTranscript(transcriptPath);
    const lastChange = entries[entries.length - 1] as any;
    expect(lastChange.type).toBe('model_change');
    expect(lastChange.provider).toBe('openrouter');
    expect(lastChange.modelId).toBe('anthropic/claude-sonnet-4');

    const session = await engine.getSession(sessionKey);
    expect(session?.providerOverride).toBe('openrouter');
    expect(session?.modelOverride).toBe('anthropic/claude-sonnet-4');
  });

  it('writes a thinking_level_change entry and mirrors thinkingLevel', async () => {
    await router.recordConfigChange(sessionKey, {
      kind: 'thinking_level',
      thinkingLevel: 'high',
    });

    const entries = store.readTranscript(transcriptPath);
    const lastChange = entries[entries.length - 1] as any;
    expect(lastChange.type).toBe('thinking_level_change');
    expect(lastChange.thinkingLevel).toBe('high');

    const session = await engine.getSession(sessionKey);
    expect(session?.thinkingLevel).toBe('high');
  });

  it('drops same-value model toggles', async () => {
    await router.recordConfigChange(sessionKey, {
      kind: 'model',
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4',
    });
    const before = store.readTranscript(transcriptPath).length;
    await router.recordConfigChange(sessionKey, {
      kind: 'model',
      provider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4',
    });
    const after = store.readTranscript(transcriptPath).length;
    expect(after).toBe(before);
  });

  it('drops same-value thinking toggles', async () => {
    await router.recordConfigChange(sessionKey, {
      kind: 'thinking_level',
      thinkingLevel: 'high',
    });
    const before = store.readTranscript(transcriptPath).length;
    await router.recordConfigChange(sessionKey, {
      kind: 'thinking_level',
      thinkingLevel: 'high',
    });
    const after = store.readTranscript(transcriptPath).length;
    expect(after).toBe(before);
  });

  it('throws when the session does not exist', async () => {
    await expect(
      router.recordConfigChange('agent:agent-A:nope', {
        kind: 'thinking_level',
        thinkingLevel: 'high',
      }),
    ).rejects.toThrow(/not found/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/sessions/session-router.recordConfigChange.test.ts`
Expected: FAIL with "router.recordConfigChange is not a function".

- [ ] **Step 3: Implement `recordConfigChange`**

Add to [server/sessions/session-router.ts](../../../server/sessions/session-router.ts), inside the `SessionRouter` class (after `updateAfterTurn`, around line 173):

```typescript
async recordConfigChange(
  sessionKey: string,
  change:
    | { kind: 'model'; provider: string; modelId: string }
    | { kind: 'thinking_level'; thinkingLevel: string },
): Promise<void> {
  const existing = await this.storageEngine.getSession(sessionKey);
  if (!existing || existing.agentId !== this.agentId) {
    throw new Error(`Session ${sessionKey} not found`);
  }

  // Same-value drop: if the mirrored value already matches, no-op. This
  // is the only deduplication; transcript-level dedup is unreliable
  // because branches and resets can replay identical values.
  if (change.kind === 'model') {
    if (
      existing.providerOverride === change.provider &&
      existing.modelOverride === change.modelId
    ) {
      return;
    }
  } else if (existing.thinkingLevel === change.thinkingLevel) {
    return;
  }

  const transcriptPath = this.storageEngine.resolveTranscriptPath(existing);
  const manager = this.transcriptStore.openSession(transcriptPath);

  if (change.kind === 'model') {
    manager.appendModelChange(change.provider, change.modelId);
  } else {
    manager.appendThinkingLevelChange(change.thinkingLevel);
  }

  const mirror: Partial<typeof existing> =
    change.kind === 'model'
      ? { providerOverride: change.provider, modelOverride: change.modelId }
      : { thinkingLevel: change.thinkingLevel };

  await this.storageEngine.updateSession(sessionKey, {
    ...mirror,
    updatedAt: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/sessions/session-router.recordConfigChange.test.ts`
Expected: PASS, 5/5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/sessions/session-router.ts server/sessions/session-router.recordConfigChange.test.ts
git commit -m "feat(sessions): add SessionRouter.recordConfigChange for per-session config persistence"
```

---

## Task 3: Add `recordConfigChange` to `AgentManager` and wire the WS handler

**Files:**
- Modify: [server/agents/agent-manager.ts](../../../server/agents/agent-manager.ts)
- Modify: [server/connections/ws-handler.ts](../../../server/connections/ws-handler.ts)
- Modify: [server/agents/agent-manager.test.ts](../../../server/agents/agent-manager.test.ts)

The `SessionRouter` is per-(agent, storage). The hot path needs to find the right one. We expose this through `AgentManager` — same shape as `dispatch`, `manualCompact`, and other per-session calls.

- [ ] **Step 1: Write the failing test**

Add to [server/agents/agent-manager.test.ts](../../../server/agents/agent-manager.test.ts) (next to the existing dispatch tests):

```typescript
describe('AgentManager.recordConfigChange', () => {
  it('routes to the SessionRouter for the agent and session', async () => {
    const apiKeys = new ApiKeyStore();
    const pluginRegistry = new ProviderPluginRegistry();
    const hitlRegistry = new HitlRegistry();
    const manager = new AgentManager(apiKeys, pluginRegistry, hitlRegistry, () => DEFAULT_SAFETY_SETTINGS);

    const config = makeConfig('agent-A');
    await manager.start(config);

    // Establish a session
    await manager.dispatch('agent-A', { sessionKey: 'agent:agent-A:main', text: 'hi' });

    await manager.recordConfigChange('agent-A', 'agent:agent-A:main', {
      kind: 'thinking_level',
      thinkingLevel: 'high',
    });

    const status = await manager.getSessionRouter('agent-A')?.getStatus('agent:agent-A:main');
    expect(status?.thinkingLevel).toBe('high');
  });

  it('throws when the agent is unknown', async () => {
    const apiKeys = new ApiKeyStore();
    const pluginRegistry = new ProviderPluginRegistry();
    const hitlRegistry = new HitlRegistry();
    const manager = new AgentManager(apiKeys, pluginRegistry, hitlRegistry, () => DEFAULT_SAFETY_SETTINGS);

    await expect(
      manager.recordConfigChange('missing', 'agent:missing:main', {
        kind: 'thinking_level',
        thinkingLevel: 'high',
      }),
    ).rejects.toThrow(/Agent .* is not running/);
  });
});
```

The test references `manager.getSessionRouter` and `manager.recordConfigChange`. Look at the existing `findAgentsByStorage` method in `AgentManager` for the SessionRouter location pattern. If `getSessionRouter` doesn't already exist, add it as a small read-only getter as part of this task.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/agents/agent-manager.test.ts -t recordConfigChange`
Expected: FAIL with "manager.recordConfigChange is not a function".

- [ ] **Step 3: Implement `recordConfigChange` on `RunCoordinator`**

`SessionRouter` is private inside `RunCoordinator` ([server/agents/run-coordinator.ts:184](../../../server/agents/run-coordinator.ts#L184)). Mirror the `manualCompact` pattern: add a public method on `RunCoordinator` that delegates to its `sessionRouter`. In [server/agents/run-coordinator.ts](../../../server/agents/run-coordinator.ts), next to `manualCompact`, add:

```typescript
async recordConfigChange(
  sessionKey: string,
  change:
    | { kind: 'model'; provider: string; modelId: string }
    | { kind: 'thinking_level'; thinkingLevel: string },
): Promise<void> {
  if (!this.sessionRouter) {
    throw new Error('Cannot recordConfigChange: no sessionRouter configured');
  }
  await this.sessionRouter.recordConfigChange(sessionKey, change);
}
```

- [ ] **Step 4: Implement `recordConfigChange` on `AgentManager`**

In [server/agents/agent-manager.ts](../../../server/agents/agent-manager.ts), copy the exact shape of `manualCompact` ([server/agents/agent-manager.ts:273-289](../../../server/agents/agent-manager.ts#L273-L289)) — pull the managed agent from `this.agents`, throw if missing, touch `lastActivity`, and delegate to the coordinator. Add right after `manualCompact`:

```typescript
async recordConfigChange(
  agentId: string,
  sessionKey: string,
  change:
    | { kind: 'model'; provider: string; modelId: string }
    | { kind: 'thinking_level'; thinkingLevel: string },
): Promise<void> {
  const managed = this.agents.get(agentId);
  if (!managed) {
    throw new Error(`Agent ${agentId} is not running`);
  }
  managed.lastActivity = Date.now();
  await managed.coordinator.recordConfigChange(sessionKey, change);
}
```

The test in Step 1 references `manager.getSessionRouter` — replace that line in the test with a direct check via `manager.recordConfigChange` then read back through `engine.getSession(sessionKey)` (using the engine the test already constructs). No `getSessionRouter` accessor is needed.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run server/agents/agent-manager.test.ts -t recordConfigChange`
Expected: PASS.

- [ ] **Step 6: Wire the WS handler**

In [server/connections/ws-handler.ts](../../../server/connections/ws-handler.ts), add a new case inside the `switch (command.type)` block (after `case 'config:setApiKeys'`):

```typescript
case 'session:set-config': {
  manager.addSocket(command.agentId, socket);
  await manager.recordConfigChange(
    command.agentId,
    command.sessionKey,
    command.change,
  );
  socket.send(JSON.stringify({
    type: 'session:config-updated',
    agentId: command.agentId,
    sessionKey: command.sessionKey,
    change: command.change,
  }));
  break;
}
```

(The `session:config-updated` ack type is new. Add it to the events section of [shared/protocol.ts](../../../shared/protocol.ts) right after `HitlListResultEvent`:

```typescript
export interface SessionConfigUpdatedEvent {
  type: 'session:config-updated';
  agentId: string;
  sessionKey: string;
  change: SessionConfigChange;
}
```

If the file has an `Event` union, add `SessionConfigUpdatedEvent` to it; otherwise nothing more is needed for the type to be reachable.)

- [ ] **Step 7: Run the WS-handler tests to verify nothing regressed**

Run: `npx vitest run server/connections/ws-handler.test.ts`
Expected: all existing tests PASS.

- [ ] **Step 8: Commit**

```bash
git add server/agents/agent-manager.ts server/agents/agent-manager.test.ts server/connections/ws-handler.ts shared/protocol.ts
git commit -m "feat(server): wire session:set-config WS command to SessionRouter.recordConfigChange"
```

---

## Task 4: Expose `getResolvedModelApi()` on `AgentRuntime`

The `model-snapshot` entry needs the resolved `Api` value (e.g. `"openai-completions"`). The runtime already calls `resolveRuntimeModel(...)` — we cache the result and expose it.

**Files:**
- Modify: [server/runtime/agent-runtime.ts](../../../server/runtime/agent-runtime.ts)
- Modify: [server/runtime/agent-runtime.test.ts](../../../server/runtime/agent-runtime.test.ts)

- [ ] **Step 1: Write the failing test**

Add to [server/runtime/agent-runtime.test.ts](../../../server/runtime/agent-runtime.test.ts):

```typescript
it('exposes the resolved model api after a successful resolve', () => {
  // The existing test setup mocks resolveRuntimeModel — extend that mock
  // to return a model with `api: 'openai-completions'`, then assert.
  const runtime = new AgentRuntime(/* ...whatever existing fixture builder ... */);
  // Force a resolve. If the existing fixture already triggers one in the
  // constructor or in dispatch, no extra call is needed.
  expect(runtime.getResolvedModelApi()).toBe('openai-completions');
});
```

(Use the existing fixture builder pattern in the file — the test file already has a mock for `resolveRuntimeModel`. The mock currently returns a fixed object; extend its return to include `api: 'openai-completions'`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run server/runtime/agent-runtime.test.ts -t "resolved model api"`
Expected: FAIL with "runtime.getResolvedModelApi is not a function".

- [ ] **Step 3: Implement the getter**

In [server/runtime/agent-runtime.ts](../../../server/runtime/agent-runtime.ts), at the spot where `resolveRuntimeModel(...)` is called (line ~16 imports it; the call happens at model setup), capture the result on a private field `private resolvedModelApi: string | null = null;` and set it after a successful resolve. Then add a public getter:

```typescript
getResolvedModelApi(): string | null {
  return this.resolvedModelApi;
}
```

(There's already a `getResolvedSystemPrompt?` pattern at [server/agents/run-coordinator.ts:1273](../../../server/agents/run-coordinator.ts#L1273) — mirror that style: optional getter, the coordinator handles `null`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run server/runtime/agent-runtime.test.ts -t "resolved model api"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/runtime/agent-runtime.ts server/runtime/agent-runtime.test.ts
git commit -m "feat(runtime): expose getResolvedModelApi() for model-snapshot transcript entries"
```

---

## Task 5: Write `model-snapshot` custom entry at run dispatch

**Files:**
- Modify: [server/agents/run-coordinator.ts](../../../server/agents/run-coordinator.ts)
- Modify: [server/agents/run-coordinator.test.ts](../../../server/agents/run-coordinator.test.ts)

- [ ] **Step 1: Write the failing test**

Add to [server/agents/run-coordinator.test.ts](../../../server/agents/run-coordinator.test.ts), inside the existing transcript-persistence describe block:

```typescript
it('writes a model-snapshot custom entry on the first dispatch', async () => {
  // Set up the standard run-coordinator harness with provider 'openrouter',
  // modelId 'anthropic/claude-sonnet-4', and mock the runtime to return
  // 'openai-completions' from getResolvedModelApi().
  // ... (use the existing harness fixture)
  await coordinator.dispatch({ sessionKey, text: 'hi' });
  await waitForTranscript();

  const entries = transcriptStore.readTranscript(transcriptPath);
  const snapshots = entries.filter(
    (e: any) => e.type === 'custom' && e.customType === 'model-snapshot',
  );
  expect(snapshots).toHaveLength(1);
  expect((snapshots[0] as any).data).toMatchObject({
    provider: 'openrouter',
    modelApi: 'openai-completions',
    modelId: 'anthropic/claude-sonnet-4',
  });
});

it('does not write a duplicate model-snapshot when nothing changed between runs', async () => {
  await coordinator.dispatch({ sessionKey, text: 'hi 1' });
  await waitForTranscript();
  await coordinator.dispatch({ sessionKey, text: 'hi 2' });
  await waitForTranscript();

  const entries = transcriptStore.readTranscript(transcriptPath);
  const snapshots = entries.filter(
    (e: any) => e.type === 'custom' && e.customType === 'model-snapshot',
  );
  expect(snapshots).toHaveLength(1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/agents/run-coordinator.test.ts -t model-snapshot`
Expected: FAIL — no `model-snapshot` entries in the transcript.

- [ ] **Step 3: Add `persistModelSnapshot`**

In [server/agents/run-coordinator.ts](../../../server/agents/run-coordinator.ts), add a constant near the top of the file (next to `RUN_DIAGNOSTIC_CUSTOM_TYPE`):

```typescript
const MODEL_SNAPSHOT_CUSTOM_TYPE = 'model-snapshot';
```

Add the following private method to the `RunCoordinator` class (place it next to `persistResolvedSystemPrompt` at line ~1272):

```typescript
/**
 * Append a `model-snapshot` custom entry capturing the server-resolved
 * {provider, modelApi, modelId} that will actually be sent to the LLM.
 * Idempotent: skipped when the most recent snapshot in the transcript
 * matches the current resolved tuple.
 *
 * Distinct from `model_change` because the snapshot includes `modelApi`
 * (the API protocol — e.g. 'openai-completions'), which is a server-
 * side resolution detail not present in the user-facing change event.
 */
private persistModelSnapshot(transcriptManager: SessionManager): void {
  const provider = this.config.provider?.pluginId;
  const modelId = this.config.modelId;
  const modelApi = this.runtime.getResolvedModelApi?.() ?? null;
  if (!provider || !modelId || !modelApi) return;

  const entries = transcriptManager.getEntries();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as unknown as {
      type?: string;
      customType?: string;
      data?: { provider?: unknown; modelApi?: unknown; modelId?: unknown };
    };
    if (entry?.type === 'custom' && entry.customType === MODEL_SNAPSHOT_CUSTOM_TYPE) {
      const d = entry.data;
      if (
        d?.provider === provider &&
        d?.modelApi === modelApi &&
        d?.modelId === modelId
      ) {
        return; // unchanged
      }
      break; // most recent snapshot found, but differs → fall through to write
    }
  }

  transcriptManager.appendCustomEntry(MODEL_SNAPSHOT_CUSTOM_TYPE, {
    timestamp: Date.now(),
    provider,
    modelApi,
    modelId,
  });
}
```

- [ ] **Step 4: Call `persistModelSnapshot` from `persistUserMessage`**

In [server/agents/run-coordinator.ts:1014](../../../server/agents/run-coordinator.ts#L1014), inside `persistUserMessage`, change the existing block:

```typescript
this.persistConfigChanges(transcriptManager);
this.persistResolvedSystemPrompt(transcriptManager);
```

to:

```typescript
this.persistConfigChanges(transcriptManager);
this.persistModelSnapshot(transcriptManager);
this.persistResolvedSystemPrompt(transcriptManager);
```

The order matters: `persistConfigChanges` writes the user-facing deltas, then the snapshot captures the resolved truth, then the system-prompt entry follows.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run server/agents/run-coordinator.test.ts -t model-snapshot`
Expected: 2/2 PASS.

- [ ] **Step 6: Commit**

```bash
git add server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts
git commit -m "feat(run-coordinator): write model-snapshot custom entry at dispatch with idempotency"
```

---

## Task 6: Mirror writes from `persistConfigChanges` into `SessionStoreEntry`

`persistConfigChanges` already writes typed transcript entries when the agent's config drifts since the last recorded baseline (e.g. the user edited the agent in the canvas). We extend it to mirror those values onto `SessionStoreEntry` so the override fields stay in sync regardless of whether the change came from the chat drawer (Task 2) or a graph edit.

**Files:**
- Modify: [server/agents/run-coordinator.ts](../../../server/agents/run-coordinator.ts)
- Modify: [server/agents/run-coordinator.test.ts](../../../server/agents/run-coordinator.test.ts)

- [ ] **Step 1: Write the failing test**

Add to [server/agents/run-coordinator.test.ts](../../../server/agents/run-coordinator.test.ts):

```typescript
it('mirrors model_change into SessionStoreEntry providerOverride/modelOverride', async () => {
  // First dispatch with provider 'openrouter', modelId 'A'
  await coordinator.dispatch({ sessionKey, text: 'hi 1' });
  await waitForTranscript();

  // Swap config to a new model (simulate canvas edit)
  // Recreate coordinator with new config OR mutate this.config (whichever
  // the harness supports — `makeConfig` is the existing pattern; produce
  // a fresh coordinator with the new config bound, dispatch, and assert).
  config = makeConfig(storagePath, { modelId: 'B' });
  coordinator = makeCoordinator(config); // reuses the existing harness builder
  await coordinator.dispatch({ sessionKey, text: 'hi 2' });
  await waitForTranscript();

  const session = await sessionRouter.getStatus(sessionKey);
  expect(session?.modelOverride).toBe('B');
});

it('mirrors thinking_level_change into SessionStoreEntry.thinkingLevel', async () => {
  config = makeConfig(storagePath, { thinkingLevel: 'high' });
  coordinator = makeCoordinator(config);
  await coordinator.dispatch({ sessionKey, text: 'hi' });
  await waitForTranscript();

  const session = await sessionRouter.getStatus(sessionKey);
  expect(session?.thinkingLevel).toBe('high');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run server/agents/run-coordinator.test.ts -t mirrors`
Expected: FAIL — `modelOverride` / `thinkingLevel` are still undefined on the SessionStoreEntry.

- [ ] **Step 3: Update `persistConfigChanges` to also mirror values**

In [server/agents/run-coordinator.ts:1243](../../../server/agents/run-coordinator.ts#L1243), update `persistConfigChanges` to track which knobs got written and pass them through `updateAfterTurn`:

```typescript
private persistConfigChanges(
  transcriptManager: SessionManager,
  sessionKey: string,
): void {
  const entries = transcriptManager.getEntries();
  const mirror: Partial<SessionStoreEntry> = {};

  const provider = this.config.provider?.pluginId;
  const modelId = this.config.modelId;
  if (typeof provider === 'string' && provider && typeof modelId === 'string' && modelId) {
    const lastModel = readLastRecordedModel(entries);
    if (lastModel && (lastModel.provider !== provider || lastModel.modelId !== modelId)) {
      transcriptManager.appendModelChange(provider, modelId);
      mirror.providerOverride = provider;
      mirror.modelOverride = modelId;
    }
  }

  const thinkingLevel = this.config.thinkingLevel;
  if (typeof thinkingLevel === 'string' && thinkingLevel) {
    const baseline = readLastRecordedThinkingLevel(entries) ?? 'off';
    if (baseline !== thinkingLevel) {
      transcriptManager.appendThinkingLevelChange(thinkingLevel);
      mirror.thinkingLevel = thinkingLevel;
    }
  }

  if (Object.keys(mirror).length > 0 && this.sessionRouter) {
    // Fire-and-forget; mirror update is best-effort and must not block
    // the run. Same pattern as `touchSession`.
    this.sessionRouter.updateAfterTurn(sessionKey, mirror).catch((err) => {
      console.error('[RunCoordinator] mirror update failed:', err);
    });
  }
}
```

Update the call site in `persistUserMessage` to pass `record.sessionKey`:

```typescript
this.persistConfigChanges(transcriptManager, record.sessionKey);
```

Add the import for `SessionStoreEntry` at the top of the file if not already present (it should be — search for `SessionStoreEntry` references).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run server/agents/run-coordinator.test.ts -t mirrors`
Expected: 2/2 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts
git commit -m "feat(run-coordinator): mirror config changes into SessionStoreEntry override fields"
```

---

## Task 7: Add the client-side WebSocket action

**Files:**
- Modify: [src/store/agent-connection-store.ts](../../../src/store/agent-connection-store.ts)
- Modify: [src/store/agent-connection-store.test.ts](../../../src/store/agent-connection-store.test.ts)

- [ ] **Step 1: Write the failing test**

Add to [src/store/agent-connection-store.test.ts](../../../src/store/agent-connection-store.test.ts):

```typescript
it('sendSessionSetConfig dispatches a session:set-config command over the websocket', async () => {
  const sent: string[] = [];
  const fakeSocket = {
    readyState: WebSocket.OPEN,
    send: vi.fn((payload: string) => sent.push(payload)),
    addEventListener: vi.fn(),
  } as unknown as WebSocket;

  const store = useAgentConnectionStore.getState();
  store._setSocketForTest(fakeSocket); // existing test seam — see other tests in this file

  store.sendSessionSetConfig('agent-A', 'agent:agent-A:main', {
    kind: 'thinking_level',
    thinkingLevel: 'high',
  });

  expect(sent).toHaveLength(1);
  expect(JSON.parse(sent[0])).toEqual({
    type: 'session:set-config',
    agentId: 'agent-A',
    sessionKey: 'agent:agent-A:main',
    change: { kind: 'thinking_level', thinkingLevel: 'high' },
  });
});
```

(If `_setSocketForTest` doesn't exist, use whatever pattern other tests in the file use to inject a test socket.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/store/agent-connection-store.test.ts -t sendSessionSetConfig`
Expected: FAIL — `sendSessionSetConfig` is not a function on the store.

- [ ] **Step 3: Add the action**

In [src/store/agent-connection-store.ts](../../../src/store/agent-connection-store.ts), inside the store creator, add (next to `sendDispatch` or whatever the existing send-prompt action is named):

```typescript
sendSessionSetConfig(
  agentId: string,
  sessionKey: string,
  change:
    | { kind: 'model'; provider: string; modelId: string }
    | { kind: 'thinking_level'; thinkingLevel: string },
): void {
  const socket = get().socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(
    JSON.stringify({
      type: 'session:set-config',
      agentId,
      sessionKey,
      change,
    }),
  );
},
```

Add the matching method signature on the store interface at the top of the file (find the `interface AgentConnectionStore` block and add `sendSessionSetConfig`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store/agent-connection-store.test.ts -t sendSessionSetConfig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/agent-connection-store.ts src/store/agent-connection-store.test.ts
git commit -m "feat(client): add sendSessionSetConfig action to agent connection store"
```

---

## Task 8: Add the chat-drawer selectors

**Files:**
- Modify: [src/chat/ChatDrawer.tsx](../../../src/chat/ChatDrawer.tsx)
- Modify: [src/chat/ChatDrawer.test.tsx](../../../src/chat/ChatDrawer.test.tsx)

This task adds two minimal selectors above the chat input row: a model `<select>` populated from `model-catalog-store` (filtered to the active provider) and a thinking-level `<select>` with the canonical values `off | low | medium | high`. On change, each fires `sendSessionSetConfig`. The current effective values come from `SessionStoreEntry.modelOverride` / `thinkingLevel`, falling back to `config.modelId` / `config.thinkingLevel`.

A richer model picker (search, grouping by provider, capability badges) is out of scope — the UI in [src/panels/property-editors/AgentProperties.tsx](../../../src/panels/property-editors/AgentProperties.tsx) is the canonical pattern; reuse it in a follow-up if needed.

- [ ] **Step 1: Write the failing test**

Add to [src/chat/ChatDrawer.test.tsx](../../../src/chat/ChatDrawer.test.tsx):

```typescript
it('changing the thinking-level selector dispatches session:set-config', async () => {
  const sendSessionSetConfig = vi.fn();
  // Inject the spy via the existing store-mock pattern in this file.
  // Most likely: vi.mock('../store/agent-connection-store') with a factory
  // that returns a getState() containing sendSessionSetConfig.

  render(<ChatDrawer agentNodeId="agent-A" /* ...other required props ... */ />);
  await userEvent.selectOptions(
    screen.getByLabelText(/thinking/i),
    'high',
  );

  expect(sendSessionSetConfig).toHaveBeenCalledWith(
    'agent-A',
    expect.stringMatching(/^agent:agent-A:/),
    { kind: 'thinking_level', thinkingLevel: 'high' },
  );
});

it('changing the model selector dispatches session:set-config', async () => {
  const sendSessionSetConfig = vi.fn();
  // ...same store-mock setup as above...

  render(<ChatDrawer agentNodeId="agent-A" /* ... */ />);
  await userEvent.selectOptions(
    screen.getByLabelText(/model/i),
    'anthropic/claude-sonnet-4',
  );

  expect(sendSessionSetConfig).toHaveBeenCalledWith(
    'agent-A',
    expect.stringMatching(/^agent:agent-A:/),
    {
      kind: 'model',
      provider: expect.any(String),
      modelId: 'anthropic/claude-sonnet-4',
    },
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/chat/ChatDrawer.test.tsx -t selector`
Expected: FAIL — no controls labeled "model" or "thinking" in the drawer.

- [ ] **Step 3: Add the selectors**

In [src/chat/ChatDrawer.tsx](../../../src/chat/ChatDrawer.tsx), add the two selectors above the chat input row. Source the model list from `useModelCatalogStore` (filter by active `config.provider.pluginId`). Source the thinking-level options from a static constant: `THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const`.

```tsx
const sendSessionSetConfig = useAgentConnectionStore((s) => s.sendSessionSetConfig);
// useSessionStore is already imported at the top of ChatDrawer.tsx (line ~8).
// Each entry in `sessions` has shape `{ meta: SessionStoreEntry; messages: Message[] }`.
const sessions = useSessionStore((s) => s.sessions);
const sessionMeta = sessions[sessionKey]?.meta;
const activeProvider = sessionMeta?.providerOverride ?? config.provider.pluginId;
const activeModelId = sessionMeta?.modelOverride ?? config.modelId;
const activeThinking = sessionMeta?.thinkingLevel ?? config.thinkingLevel ?? 'off';

// useModelCatalogStore is the existing model-catalog client store. Use whichever
// selector returns the per-provider model list — see how AgentProperties.tsx
// reads it (file: src/panels/property-editors/AgentProperties.tsx). If no such
// selector exists, derive it inline: filter the full catalog by pluginId.
const models = useModelCatalogStore((s) => s.modelsForProvider(activeProvider));

return (
  <div className="chat-config-row">
    <label>
      Model
      <select
        value={activeModelId}
        onChange={(e) => sendSessionSetConfig(agentId, sessionKey, {
          kind: 'model',
          provider: activeProvider,
          modelId: e.target.value,
        })}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.id}</option>
        ))}
      </select>
    </label>
    <label>
      Thinking
      <select
        value={activeThinking}
        onChange={(e) => sendSessionSetConfig(agentId, sessionKey, {
          kind: 'thinking_level',
          thinkingLevel: e.target.value,
        })}
      >
        {THINKING_LEVELS.map((lvl) => (
          <option key={lvl} value={lvl}>{lvl}</option>
        ))}
      </select>
    </label>
  </div>
);
```

(The exact placement is above the existing chat input row — the file has a clear section for `{/* Session selector row */}` near line 407; add this block just after it. Match the existing class names / styling conventions.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/chat/ChatDrawer.test.tsx -t selector`
Expected: 2/2 PASS.

- [ ] **Step 5: Smoke-test in the dev server**

Start: `npm run dev:server` in one terminal, `npm run dev:client` in another.

In the browser, open a chat session. Toggle the thinking-level dropdown to `high`, send a message, then in another terminal:

```bash
cat .pi/agent/sessions/<encoded-cwd>/<sessionId>.jsonl | tail -10
```

Expected:
- A `thinking_level_change` entry with `thinkingLevel: 'high'` appears before the next user message.
- A `custom` `model-snapshot` entry appears at first dispatch.
- `cat <storage>/agents/agent-A/sessions.json` shows the session's `thinkingLevel: 'high'`.

If anything is missing, return to Phase 1 of `superpowers:systematic-debugging`.

- [ ] **Step 6: Commit**

```bash
git add src/chat/ChatDrawer.tsx src/chat/ChatDrawer.test.tsx
git commit -m "feat(chat): add per-session model and thinking-level selectors to chat drawer"
```

---

## Task 9: Final integration check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm run test:run`
Expected: all PASS.

- [ ] **Step 2: Type-check**

Run: `npx tsc -p . --noEmit`
Expected: clean.

- [ ] **Step 3: End-to-end verification of an existing session**

Open the dev server, chat with the agent, change the model, then close the browser. Reopen the chat. Confirm the chat drawer shows the new model in the selector (read from `SessionStoreEntry.modelOverride`).

- [ ] **Step 4: Document the new transcript entries**

Update [docs/concepts/_manifest.json](../../../docs/concepts/_manifest.json) and the relevant concept doc (most likely the transcript / session-management concept doc) to mention `model_change`, `thinking_level_change`, and `custom/model-snapshot` entries. Update the `<!-- last-verified: YYYY-MM-DD -->` comment.

- [ ] **Step 5: Commit the docs**

```bash
git add docs/concepts/
git commit -m "docs: document session config-change transcript entries"
```

---

## Spec Coverage Self-Review

| Spec section | Covered by |
|---|---|
| `model_change` typed entry | Task 2 (toggle path), Task 6 (drift path) |
| `thinking_level_change` typed entry | Task 2 (toggle path), Task 6 (drift path) |
| `custom` `model-snapshot` entry | Task 5 |
| Mirror writes (providerOverride/modelOverride/thinkingLevel) | Task 2, Task 6 |
| WS protocol for per-toggle | Task 1, Task 3 |
| Chat-drawer UI controls | Task 8 |
| Same-value drop (toggle layer) | Task 2, Step 3 |
| Snapshot idempotency | Task 5, Step 3 |
| Reset / clear edge case | implicit — Task 5's idempotency walks the *current* transcript, so a fresh transcript will write a fresh snapshot |
| Branch edge case | implicit — same reason |
| Failed transcript append | covered by `recordConfigChange`'s atomic ordering: append throws → mirror not updated → handler bubbles error to WS reply |
