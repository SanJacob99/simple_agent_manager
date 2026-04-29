# Session Tools: Yield Orchestration, List Filters, History Pagination — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sessions_yield` actually orchestrate (async resume on sub-agent completion or timeout), add `label` / `agent` / `preview` filters to `sessions_list`, and add `before` cursor + budget caps to `sessions_history`.

**Architecture:** Three changes to the existing tool layer in `server/sessions/session-tools.ts`, backed by a stateful rewrite of `SubAgentRegistry` (boolean flag → per-parent `YieldState` map with timer + resolve callback) and a new `resolveYield` callback wired by `RunCoordinator`. A new custom transcript entry (`sam.sub_agent_resume`) marks the auto-resume turn so the UI can render it distinctively.

**Tech Stack:** TypeScript, vitest, `@sinclair/typebox` (tool param schemas), `@mariozechner/pi-coding-agent` (`SessionManager.appendCustomEntry` / `transcriptStore.snapshot`), pi-ai user-message shape.

**Spec:** [docs/superpowers/specs/2026-04-29-session-tools-yield-list-history-design.md](../specs/2026-04-29-session-tools-yield-list-history-design.md)

---

## File Structure

### Modified
| File | Responsibility |
|---|---|
| `shared/session-diagnostics.ts` | Add `SUB_AGENT_RESUME_CUSTOM_TYPE` constant + data types alongside the existing `RUN_DIAGNOSTIC_CUSTOM_TYPE`. |
| `server/agents/sub-agent-registry.ts` | Replace boolean `yieldPending` flag with `YieldState` map; add timer-driven resolve, idempotency, cancel. |
| `server/agents/sub-agent-registry.test.ts` | NEW — exercise the registry's yield surface in isolation. |
| `server/sessions/session-tools.ts` | Update three tool factories: `sessions_list` (filters), `sessions_history` (pagination + JSON output), `sessions_yield` (uses `ctx.resolveYield`). Add a `parentAgentId` field to `SessionToolContext` and a `resolveYield` callback. |
| `server/sessions/session-tools.test.ts` | Add cases for new filters, pagination, yield text branches. Update existing yield mock. |
| `server/agents/run-coordinator.ts` | Build `resolveYield` callback; pass `parentAgentId` and `resolveYield` through `SessionToolContext`; cancel yields in `destroy()`. |

No new module files beyond the new test file.

---

## Task 1: Add `sam.sub_agent_resume` custom transcript entry types

**Files:**
- Modify: `shared/session-diagnostics.ts`

- [ ] **Step 1: Add the constant and data types**

Append to `shared/session-diagnostics.ts` (after the `formatRunDiagnostic` function at the end of the file):

```typescript
export const SUB_AGENT_RESUME_CUSTOM_TYPE = 'sam.sub_agent_resume';

export interface SubAgentResumeResult {
  subAgentId: string;
  targetAgentId: string;
  sessionKey: string;
  status: 'completed' | 'error' | 'running';
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  text?: string;
  error?: string;
}

export interface SubAgentResumeData {
  generatedFromRunId: string;
  reason: 'all-complete' | 'timeout';
  generatedAt: number;
  results: SubAgentResumeResult[];
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add shared/session-diagnostics.ts
git commit -m "feat(session-tools): add sam.sub_agent_resume custom transcript entry types"
```

---

## Task 2: Rewrite `SubAgentRegistry` yield to be a stateful coordinator

**Files:**
- Modify: `server/agents/sub-agent-registry.ts`
- Create: `server/agents/sub-agent-registry.test.ts`

The existing registry keeps a `Set<string>` of "yield pending" parents and never resolves anything. We replace that with a `Map<string, YieldState>` per parent, where each state owns the safety timeout timer and the resolve callback. Every terminal sub-agent event checks the parent's state and resolves once all running children finish. Timer firing also resolves once. Resolution is idempotent.

The registry exports `ResumePayload` (used by `RunCoordinator`'s `resolveYield` callback to dispatch the synthetic user turn).

- [ ] **Step 1: Write the failing test file**

Create `server/agents/sub-agent-registry.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubAgentRegistry, type ResumePayload } from './sub-agent-registry';

const PARENT_KEY = 'agent:p:main';
const PARENT_AGENT = 'p';
const PARENT_RUN = 'run-parent';

function spawnChild(reg: SubAgentRegistry, runId: string, targetAgentId = 'c') {
  return reg.spawn(
    { sessionKey: PARENT_KEY, runId: PARENT_RUN },
    { agentId: targetAgentId, sessionKey: `sub:${PARENT_KEY}:${runId}`, runId },
  );
}

describe('SubAgentRegistry yield orchestration', () => {
  let reg: SubAgentRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    reg = new SubAgentRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no-active-subs when no children are running', () => {
    const resolve = vi.fn();
    const result = reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 10_000 },
      resolve,
    );
    expect(result).toEqual({ setupOk: false, reason: 'no-active-subs' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns already-pending on a second setYieldPending for the same parent', () => {
    spawnChild(reg, 'r1');
    const r1 = reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 10_000 },
      vi.fn(),
    );
    expect(r1.setupOk).toBe(true);

    const r2 = reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 10_000 },
      vi.fn(),
    );
    expect(r2).toEqual({ setupOk: false, reason: 'already-pending' });
  });

  it('resolves with all-complete when the last running child completes', () => {
    spawnChild(reg, 'r1');
    spawnChild(reg, 'r2');
    const resolve = vi.fn<(p: ResumePayload) => void>();

    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 60_000 },
      resolve,
    );

    reg.onComplete('r1', 'first reply');
    expect(resolve).not.toHaveBeenCalled();

    reg.onComplete('r2', 'second reply');
    expect(resolve).toHaveBeenCalledTimes(1);

    const payload = resolve.mock.calls[0][0];
    expect(payload.reason).toBe('all-complete');
    expect(payload.parentSessionKey).toBe(PARENT_KEY);
    expect(payload.parentAgentId).toBe(PARENT_AGENT);
    expect(payload.parentRunId).toBe(PARENT_RUN);
    expect(payload.results).toHaveLength(2);
    expect(payload.results.map((r) => r.status)).toEqual(['completed', 'completed']);
    expect(payload.results.map((r) => r.text)).toEqual(['first reply', 'second reply']);
  });

  it('resolves with timeout when subs do not finish in time', () => {
    spawnChild(reg, 'r1');
    spawnChild(reg, 'r2');
    const resolve = vi.fn<(p: ResumePayload) => void>();

    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 5_000 },
      resolve,
    );

    reg.onComplete('r1', 'first reply');
    expect(resolve).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);

    expect(resolve).toHaveBeenCalledTimes(1);
    const payload = resolve.mock.calls[0][0];
    expect(payload.reason).toBe('timeout');
    const statuses = payload.results.map((r) => r.status).sort();
    expect(statuses).toEqual(['completed', 'running']);
  });

  it('does not double-resolve when both timeout and final completion fire', () => {
    spawnChild(reg, 'r1');
    const resolve = vi.fn<(p: ResumePayload) => void>();

    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 5_000 },
      resolve,
    );

    vi.advanceTimersByTime(5_000);
    reg.onComplete('r1', 'late reply');

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('cancelYield clears the timer and prevents resolve', () => {
    spawnChild(reg, 'r1');
    const resolve = vi.fn<(p: ResumePayload) => void>();

    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 5_000 },
      resolve,
    );

    reg.cancelYield(PARENT_KEY);

    vi.advanceTimersByTime(60_000);
    reg.onComplete('r1', 'reply');

    expect(resolve).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail**

Run: `npx vitest run server/agents/sub-agent-registry.test.ts`
Expected: All tests fail (`setYieldPending` signature is wrong, `cancelYield` does not exist, `ResumePayload` is not exported).

- [ ] **Step 3: Rewrite `server/agents/sub-agent-registry.ts`**

Replace the entire contents with:

```typescript
import { randomUUID } from 'crypto';

export interface SubAgentRecord {
  subAgentId: string;
  parentSessionKey: string;
  parentRunId: string;
  targetAgentId: string;
  sessionKey: string;
  runId: string;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  endedAt?: number;
  result?: string;
  error?: string;
}

export interface ResumeResult {
  subAgentId: string;
  targetAgentId: string;
  sessionKey: string;
  status: 'completed' | 'error' | 'running';
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  text?: string;
  error?: string;
}

export interface ResumePayload {
  parentSessionKey: string;
  parentAgentId: string;
  parentRunId: string;
  results: ResumeResult[];
  reason: 'all-complete' | 'timeout';
}

export interface SetYieldOpts {
  parentAgentId: string;
  parentRunId: string;
  timeoutMs: number;
}

export type SetYieldResult =
  | { setupOk: true }
  | { setupOk: false; reason: 'no-active-subs' | 'already-pending' };

interface YieldState {
  parentSessionKey: string;
  parentAgentId: string;
  parentRunId: string;
  startedAt: number;
  timeoutMs: number;
  timeoutTimer: ReturnType<typeof setTimeout>;
  resolve: (payload: ResumePayload) => void;
  resolved: boolean;
}

export class SubAgentRegistry {
  private readonly records = new Map<string, SubAgentRecord>();
  private readonly byRunId = new Map<string, string>();
  private readonly yields = new Map<string, YieldState>();

  spawn(
    parent: { sessionKey: string; runId: string },
    target: { agentId: string; sessionKey: string; runId: string },
  ): SubAgentRecord {
    const subAgentId = randomUUID();
    const record: SubAgentRecord = {
      subAgentId,
      parentSessionKey: parent.sessionKey,
      parentRunId: parent.runId,
      targetAgentId: target.agentId,
      sessionKey: target.sessionKey,
      runId: target.runId,
      status: 'running',
      startedAt: Date.now(),
    };
    this.records.set(subAgentId, record);
    this.byRunId.set(target.runId, subAgentId);
    return record;
  }

  onComplete(runId: string, result: string): void {
    const record = this.recordForRunId(runId);
    if (!record || record.status !== 'running') return;
    record.status = 'completed';
    record.result = result;
    record.endedAt = Date.now();
    this.maybeResolveYield(record.parentSessionKey);
  }

  onError(runId: string, error: string): void {
    const record = this.recordForRunId(runId);
    if (!record || record.status !== 'running') return;
    record.status = 'error';
    record.error = error;
    record.endedAt = Date.now();
    this.maybeResolveYield(record.parentSessionKey);
  }

  listForParent(parentSessionKey: string): SubAgentRecord[] {
    return [...this.records.values()].filter(
      (r) => r.parentSessionKey === parentSessionKey,
    );
  }

  get(subAgentId: string): SubAgentRecord | null {
    return this.records.get(subAgentId) ?? null;
  }

  kill(subAgentId: string): boolean {
    const record = this.records.get(subAgentId);
    if (!record || record.status !== 'running') return false;
    record.status = 'error';
    record.error = 'Killed by parent';
    record.endedAt = Date.now();
    this.maybeResolveYield(record.parentSessionKey);
    return true;
  }

  allComplete(parentSessionKey: string): boolean {
    const children = this.listForParent(parentSessionKey);
    return children.length > 0 && children.every((r) => r.status !== 'running');
  }

  setYieldPending(
    parentSessionKey: string,
    opts: SetYieldOpts,
    resolve: (payload: ResumePayload) => void,
  ): SetYieldResult {
    if (this.yields.has(parentSessionKey)) {
      return { setupOk: false, reason: 'already-pending' };
    }

    const running = this.listForParent(parentSessionKey).filter((r) => r.status === 'running');
    if (running.length === 0) {
      return { setupOk: false, reason: 'no-active-subs' };
    }

    const state: YieldState = {
      parentSessionKey,
      parentAgentId: opts.parentAgentId,
      parentRunId: opts.parentRunId,
      startedAt: Date.now(),
      timeoutMs: opts.timeoutMs,
      timeoutTimer: setTimeout(() => this.resolveOnTimeout(parentSessionKey), opts.timeoutMs),
      resolve,
      resolved: false,
    };
    this.yields.set(parentSessionKey, state);
    return { setupOk: true };
  }

  cancelYield(parentSessionKey: string): void {
    const state = this.yields.get(parentSessionKey);
    if (!state) return;
    clearTimeout(state.timeoutTimer);
    state.resolved = true;
    this.yields.delete(parentSessionKey);
  }

  isYieldPending(parentSessionKey: string): boolean {
    return this.yields.has(parentSessionKey);
  }

  private recordForRunId(runId: string): SubAgentRecord | undefined {
    const subAgentId = this.byRunId.get(runId);
    if (!subAgentId) return undefined;
    return this.records.get(subAgentId);
  }

  private maybeResolveYield(parentSessionKey: string): void {
    const state = this.yields.get(parentSessionKey);
    if (!state || state.resolved) return;

    const stillRunning = this.listForParent(parentSessionKey).some((r) => r.status === 'running');
    if (stillRunning) return;

    this.finishYield(state, 'all-complete');
  }

  private resolveOnTimeout(parentSessionKey: string): void {
    const state = this.yields.get(parentSessionKey);
    if (!state || state.resolved) return;
    this.finishYield(state, 'timeout');
  }

  private finishYield(state: YieldState, reason: 'all-complete' | 'timeout'): void {
    state.resolved = true;
    clearTimeout(state.timeoutTimer);
    this.yields.delete(state.parentSessionKey);

    const results: ResumeResult[] = this.listForParent(state.parentSessionKey).map((r) => ({
      subAgentId: r.subAgentId,
      targetAgentId: r.targetAgentId,
      sessionKey: r.sessionKey,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationMs: (r.endedAt ?? Date.now()) - r.startedAt,
      text: r.result,
      error: r.error,
    }));

    state.resolve({
      parentSessionKey: state.parentSessionKey,
      parentAgentId: state.parentAgentId,
      parentRunId: state.parentRunId,
      results,
      reason,
    });
  }
}
```

- [ ] **Step 4: Run the new tests, confirm they pass**

Run: `npx vitest run server/agents/sub-agent-registry.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Run the existing test suite to confirm no regressions**

Run: `npx vitest run server/agents`
Expected: All tests PASS. (`run-coordinator.test.ts` will continue to pass — it does not exercise the yield surface.)

- [ ] **Step 6: Commit**

```bash
git add server/agents/sub-agent-registry.ts server/agents/sub-agent-registry.test.ts
git commit -m "feat(sub-agent-registry): replace yield flag with stateful YieldState + timeout"
```

---

## Task 3: Add `label` / `agent` / `preview` filters to `sessions_list`

**Files:**
- Modify: `server/sessions/session-tools.ts:36-85`
- Modify: `server/sessions/session-tools.test.ts`

The current tool ignores `label`, `agent`, `preview`. We add the schema, the filter pipeline, and the optional preview-extraction path that reads transcripts (capped at 50 sessions to bound cost).

- [ ] **Step 1: Write failing tests**

Append to `server/sessions/session-tools.test.ts` after the existing `describe('sessions_list', ...)` block:

```typescript
describe('sessions_list filters', () => {
  it('matches label substring case-insensitively', async () => {
    const ctx = createMockContext();
    (ctx.sessionRouter.listSessions as any).mockResolvedValue([
      mockSession({ sessionKey: 'agent:a1:s1', displayName: 'Daily Standup' }),
      mockSession({ sessionKey: 'agent:a1:s2', displayName: 'Bug Triage' }),
      mockSession({ sessionKey: 'agent:a1:s3', displayName: undefined }),
    ]);

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    const result = await tool.execute('call-1', { label: 'standup' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.map((s: any) => s.sessionKey)).toEqual(['agent:a1:s1']);
  });

  it('rejects cross-agent agent filter with explicit text', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    const result = await tool.execute('call-1', { agent: 'other-agent' });

    expect(result.content[0].text).toContain('Cross-agent listing is not yet supported');
  });

  it('accepts agent filter when it equals callerAgentId', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    const result = await tool.execute('call-1', { agent: 'a1' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed).toHaveLength(1);
  });

  it('includes preview text and messageCount when preview=true', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue([
      { type: 'message', id: 'e1', message: { role: 'user', content: 'Tell me a long story about cats' }, timestamp: '2026-04-08T00:00:00.000Z' },
      { type: 'message', id: 'e2', message: { role: 'assistant', content: 'Once upon a time...' }, timestamp: '2026-04-08T00:01:00.000Z' },
      { type: 'message', id: 'e3', message: { role: 'user', content: 'Continue please' }, timestamp: '2026-04-08T00:02:00.000Z' },
    ]);

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    const result = await tool.execute('call-1', { preview: true });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed[0].preview).toBe('Tell me a long story about cats');
    expect(parsed[0].messageCount).toBe(3);
  });

  it('caps preview reads at 50 sessions', async () => {
    const ctx = createMockContext();
    const sessions = Array.from({ length: 75 }, (_, i) =>
      mockSession({ sessionKey: `agent:a1:s${i}`, sessionId: `sid-${i}` }),
    );
    (ctx.sessionRouter.listSessions as any).mockResolvedValue(sessions);
    (ctx.transcriptStore.readTranscript as any).mockReturnValue([]);

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;

    await tool.execute('call-1', { preview: true });

    expect(ctx.transcriptStore.readTranscript).toHaveBeenCalledTimes(50);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npx vitest run server/sessions/session-tools.test.ts -t "sessions_list filters"`
Expected: All five tests FAIL.

- [ ] **Step 3: Rewrite `createSessionsListTool` in `server/sessions/session-tools.ts`**

Replace the existing `createSessionsListTool` function (lines roughly 36-85) with:

```typescript
function createSessionsListTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_list',
    description:
      'List sessions for this agent. Filters: kind, recency (minutes), label (substring of displayName, case-insensitive), agent (must equal caller agentId for now), preview (boolean — when true, results include preview text + messageCount; capped at 50 sessions).',
    label: 'Sessions List',
    parameters: Type.Object({
      kind: Type.Optional(
        Type.Union([
          Type.Literal('all'),
          Type.Literal('agent'),
          Type.Literal('cron'),
        ], { description: 'Filter sessions by kind (default: all)' }),
      ),
      recency: Type.Optional(
        Type.Number({ description: 'Only return sessions updated within this many minutes' }),
      ),
      label: Type.Optional(
        Type.String({ description: 'Substring match (case-insensitive) against displayName' }),
      ),
      agent: Type.Optional(
        Type.String({ description: 'Filter by agentId; must equal caller agentId in this version' }),
      ),
      preview: Type.Optional(
        Type.Boolean({ description: 'Include preview text + messageCount per session (capped at 50)' }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const requestedAgent = params.agent as string | undefined;
        if (requestedAgent && requestedAgent !== ctx.callerAgentId) {
          return textResult(
            `Cross-agent listing is not yet supported; only the caller's own agentId ("${ctx.callerAgentId}") is accepted.`,
          );
        }

        let sessions = await ctx.sessionRouter.listSessions();

        const kind = (params.kind as string | undefined) ?? 'all';
        if (kind === 'agent') {
          sessions = sessions.filter((s) => s.sessionKey.startsWith('agent:'));
        } else if (kind === 'cron') {
          sessions = sessions.filter((s) => s.sessionKey.startsWith('cron:'));
        }

        if (params.recency != null) {
          const cutoffStr = new Date(Date.now() - (params.recency as number) * 60 * 1000).toISOString();
          sessions = sessions.filter((s) => s.updatedAt >= cutoffStr);
        }

        const label = params.label as string | undefined;
        if (label) {
          const needle = label.toLowerCase();
          sessions = sessions.filter(
            (s) => typeof s.displayName === 'string' && s.displayName.toLowerCase().includes(needle),
          );
        }

        const wantsPreview = params.preview === true;
        const previewCapped = wantsPreview ? sessions.slice(0, 50) : sessions;

        const summary = previewCapped.map((s) => {
          const base = {
            sessionKey: s.sessionKey,
            sessionId: s.sessionId,
            chatType: s.chatType,
            updatedAt: s.updatedAt,
            totalTokens: s.totalTokens,
            displayName: s.displayName,
          };
          if (!wantsPreview) return base;
          return { ...base, ...readPreview(ctx, s) };
        });

        return textResult(JSON.stringify(summary, null, 2));
      } catch (e) {
        return textResult(`Error listing sessions: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function readPreview(
  ctx: SessionToolContext,
  session: { sessionKey: string; sessionFile?: string } & Record<string, unknown>,
): { preview: string; messageCount: number } {
  try {
    const transcriptPath = ctx.storageEngine.resolveTranscriptPath(session as any);
    const entries = ctx.transcriptStore.readTranscript(transcriptPath);
    let messageCount = 0;
    let firstUserText: string | undefined;
    for (const entry of entries as any[]) {
      if (entry?.type !== 'message') continue;
      messageCount += 1;
      if (firstUserText === undefined && entry.message?.role === 'user') {
        const content = entry.message.content;
        if (typeof content === 'string') {
          firstUserText = content;
        } else if (Array.isArray(content)) {
          const textBlock = content.find((b: any) => b?.type === 'text' && typeof b.text === 'string');
          firstUserText = textBlock?.text;
        }
      }
    }
    const preview = (firstUserText ?? '').slice(0, 120);
    return { preview, messageCount };
  } catch {
    return { preview: '', messageCount: 0 };
  }
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run server/sessions/session-tools.test.ts -t "sessions_list"`
Expected: All `sessions_list` tests PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add server/sessions/session-tools.ts server/sessions/session-tools.test.ts
git commit -m "feat(sessions_list): add label/agent/preview filters with caller-scoped guard"
```

---

## Task 4: Add `before` cursor + budget caps to `sessions_history`

**Files:**
- Modify: `server/sessions/session-tools.ts:87-119`
- Modify: `server/sessions/session-tools.test.ts`

The new tool returns JSON in a single text block, newest-first, paginated with a `before: <entryId>` cursor and a 12 000-char total response cap. Tool results are included by default but more aggressively truncated.

- [ ] **Step 1: Write failing tests**

Append to `server/sessions/session-tools.test.ts` (after the existing `describe('sessions_history', ...)`):

```typescript
function makeTranscriptEntries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    type: 'message',
    id: `e${i + 1}`,
    parentId: i === 0 ? null : `e${i}`,
    timestamp: new Date(Date.parse('2026-04-08T00:00:00.000Z') + i * 60_000).toISOString(),
    message: {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1} body`,
    },
  }));
}

describe('sessions_history pagination', () => {
  it('returns the most recent entries newest-first by default', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue(makeTranscriptEntries(50));

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main' });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.entries[0].id).toBe('e50');
    expect(parsed.entries.at(-1).id).toBe('e31');
    expect(parsed.entries).toHaveLength(20);
    expect(parsed.nextCursor).toBe('e31');
    expect(parsed.totalEntries).toBe(50);
  });

  it('respects the before cursor', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue(makeTranscriptEntries(50));

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main', before: 'e31', limit: 10 });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.entries[0].id).toBe('e30');
    expect(parsed.entries.at(-1).id).toBe('e21');
    expect(parsed.nextCursor).toBe('e21');
  });

  it('returns explicit error for unknown cursor', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue(makeTranscriptEntries(5));

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main', before: 'nope' });
    expect(result.content[0].text).toContain('Cursor not found');
  });

  it('truncates with truncated:true when total budget is exceeded', async () => {
    const ctx = createMockContext();
    const big = 'X'.repeat(2000);
    (ctx.transcriptStore.readTranscript as any).mockReturnValue(
      Array.from({ length: 30 }, (_, i) => ({
        type: 'message',
        id: `e${i + 1}`,
        parentId: i === 0 ? null : `e${i}`,
        timestamp: new Date(Date.parse('2026-04-08T00:00:00.000Z') + i * 60_000).toISOString(),
        message: { role: 'assistant', content: big },
      })),
    );

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main', limit: 30 });
    const parsed = JSON.parse(result.content[0].text);

    // Each entry text capped at 500 + JSON overhead. Budget = 12_000 chars; we should
    // get fewer than 30 entries back and truncated must be true with a valid cursor.
    expect(parsed.entries.length).toBeLessThan(30);
    expect(parsed.truncated).toBe(true);
    expect(parsed.nextCursor).toBeDefined();
  });

  it('excludes tool results when includeToolResults is false', async () => {
    const ctx = createMockContext();
    (ctx.transcriptStore.readTranscript as any).mockReturnValue([
      { type: 'message', id: 'e1', message: { role: 'user', content: 'Hi' }, timestamp: '2026-04-08T00:00:00.000Z' },
      { type: 'toolResult', id: 'e2', toolName: 'web_search', content: [{ type: 'text', text: 'long result' }], timestamp: '2026-04-08T00:00:30.000Z' },
      { type: 'message', id: 'e3', message: { role: 'assistant', content: 'Done' }, timestamp: '2026-04-08T00:01:00.000Z' },
    ]);

    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main', includeToolResults: false });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.entries.map((e: any) => e.id)).toEqual(['e3', 'e1']);
    expect(parsed.totalEntries).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests, confirm they fail**

Run: `npx vitest run server/sessions/session-tools.test.ts -t "sessions_history pagination"`
Expected: 5 tests FAIL.

- [ ] **Step 3: Rewrite `createSessionsHistoryTool` in `server/sessions/session-tools.ts`**

Replace the existing `createSessionsHistoryTool` function with:

```typescript
const HISTORY_MESSAGE_CHAR_CAP = 500;
const HISTORY_TOOL_CHAR_CAP = 200;
const HISTORY_TOTAL_CHAR_BUDGET = 12_000;
const HISTORY_DEFAULT_LIMIT = 20;
const HISTORY_MAX_LIMIT = 200;

function createSessionsHistoryTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_history',
    description:
      'Read transcript entries from a session. Newest-first; paginate older with `before: <entryId>`. Messages truncated at 500 chars; tool results at 200 chars; total response capped near 12 000 chars (truncated:true + nextCursor when capped).',
    label: 'Sessions History',
    parameters: Type.Object({
      sessionKey: Type.String({ description: 'The session key to read history from' }),
      limit: Type.Optional(
        Type.Number({ description: `Max entries to return (default ${HISTORY_DEFAULT_LIMIT}, hard cap ${HISTORY_MAX_LIMIT})` }),
      ),
      before: Type.Optional(
        Type.String({ description: 'EntryId cursor — only entries strictly older than this id are returned' }),
      ),
      includeToolResults: Type.Optional(
        Type.Boolean({ description: 'Include toolResult entries (default true)' }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const sessionKey = params.sessionKey as string;
        const session = await ctx.sessionRouter.getStatus(sessionKey);
        if (!session) {
          return textResult(`Session not found: ${sessionKey}`);
        }

        const transcriptPath = ctx.storageEngine.resolveTranscriptPath(session);
        const rawEntries = ctx.transcriptStore.readTranscript(transcriptPath) as any[];

        const includeToolResults = params.includeToolResults !== false;
        const filtered = rawEntries.filter((e) => {
          if (e?.type === 'message') return true;
          if (e?.type === 'toolResult') return includeToolResults;
          return false;
        });

        const before = params.before as string | undefined;
        let chronological = filtered;
        if (before) {
          const idx = filtered.findIndex((e) => e?.id === before);
          if (idx === -1) {
            return textResult(`Cursor not found: ${before}`);
          }
          chronological = filtered.slice(0, idx);
        }

        const requestedLimit = typeof params.limit === 'number'
          ? Math.max(1, Math.min(params.limit, HISTORY_MAX_LIMIT))
          : HISTORY_DEFAULT_LIMIT;

        const slice = chronological.slice(-requestedLimit).reverse();

        const formatted: Array<Record<string, unknown>> = [];
        let used = 0;
        let truncated = false;

        for (const entry of slice) {
          const rendered = renderHistoryEntry(entry);
          const projectedSize = used + JSON.stringify(rendered).length + 2; // ", " overhead
          if (formatted.length > 0 && projectedSize > HISTORY_TOTAL_CHAR_BUDGET) {
            truncated = true;
            break;
          }
          formatted.push(rendered);
          used = projectedSize;
        }

        const nextCursor = formatted.length > 0
          ? (formatted[formatted.length - 1].id as string | undefined)
          : undefined;
        const exhaustedLeft = !truncated && formatted.length === slice.length
          && (chronological.length <= requestedLimit);

        return textResult(JSON.stringify({
          sessionKey,
          entries: formatted,
          nextCursor: exhaustedLeft ? undefined : nextCursor,
          truncated,
          totalEntries: filtered.length,
        }, null, 2));
      } catch (e) {
        return textResult(`Error reading history: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function renderHistoryEntry(entry: any): Record<string, unknown> {
  if (entry.type === 'toolResult') {
    return {
      id: entry.id,
      type: 'toolResult',
      toolName: entry.toolName,
      timestamp: entry.timestamp,
      text: truncate(extractEntryText(entry.content), HISTORY_TOOL_CHAR_CAP),
    };
  }

  const role = entry.message?.role ?? 'unknown';
  return {
    id: entry.id,
    type: 'message',
    role,
    timestamp: entry.timestamp,
    text: truncate(extractEntryText(entry.message?.content), HISTORY_MESSAGE_CHAR_CAP),
  };
}

function extractEntryText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    let out = '';
    for (const block of content) {
      if (block && typeof block === 'object' && (block as any).type === 'text') {
        out += (block as any).text ?? '';
      } else if (block && typeof block === 'object' && (block as any).type === 'toolCall') {
        out += `\n[toolCall name=${(block as any).name}]`;
      }
    }
    return out;
  }
  if (content == null) return '';
  return String(content);
}
```

- [ ] **Step 4: Update the existing `sessions_history` test**

The pre-existing test (`'returns formatted transcript'`) used the old plain-text output. Update it:

```typescript
describe('sessions_history', () => {
  it('returns JSON with entries newest-first', async () => {
    const ctx = createMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;

    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main' });
    expect(ctx.sessionRouter.getStatus).toHaveBeenCalledWith('agent:a1:main');
    expect(ctx.storageEngine.resolveTranscriptPath).toHaveBeenCalled();
    expect(ctx.transcriptStore.readTranscript).toHaveBeenCalled();

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.sessionKey).toBe('agent:a1:main');
    expect(Array.isArray(parsed.entries)).toBe(true);
  });
});
```

Also update the `transcriptStore.readTranscript` mock in `createMockContext` so it matches the new pipeline (entries with `type: 'message'` and a `message` payload):

```typescript
transcriptStore: {
  readTranscript: vi.fn().mockReturnValue([
    {
      type: 'message',
      id: 'e1',
      parentId: null,
      timestamp: '2026-04-08T00:00:00.000Z',
      message: { role: 'user', content: 'Hello' },
    },
    {
      type: 'message',
      id: 'e2',
      parentId: 'e1',
      timestamp: '2026-04-08T00:01:00.000Z',
      message: { role: 'assistant', content: 'Hi there, how can I help?' },
    },
  ]),
} as any,
```

- [ ] **Step 5: Run all session-tools tests**

Run: `npx vitest run server/sessions/session-tools.test.ts`
Expected: All tests PASS (existing + new pagination cases).

- [ ] **Step 6: Commit**

```bash
git add server/sessions/session-tools.ts server/sessions/session-tools.test.ts
git commit -m "feat(sessions_history): add before-cursor pagination + 12k-char total budget"
```

---

## Task 5: Rewrite `sessions_yield` to use `ctx.resolveYield`

**Files:**
- Modify: `server/sessions/session-tools.ts`
- Modify: `server/sessions/session-tools.test.ts`

The tool no longer calls `subAgentRegistry.setYieldPending` directly; instead it goes through a `ctx.resolveYield` callback that the coordinator wires (Task 6). The tool produces three text branches based on the registry's `{ setupOk, reason }` return.

- [ ] **Step 1: Extend `SessionToolContext`**

In `server/sessions/session-tools.ts`, near the top, change the imports and interface:

```typescript
import type { SetYieldOpts, SetYieldResult } from '../agents/sub-agent-registry';

export interface SessionToolContext {
  callerSessionKey: string;
  callerAgentId: string;
  callerRunId: string;
  sessionRouter: SessionRouter;
  storageEngine: StorageEngine;
  transcriptStore: SessionTranscriptStore;
  coordinator: RunCoordinator;
  subAgentRegistry: SubAgentRegistry;
  coordinatorLookup: (agentId: string) => RunCoordinator | null;
  subAgentSpawning: boolean;
  enabledToolNames: string[];
  /**
   * Optional callback wired by RunCoordinator. Forwards to
   * SubAgentRegistry.setYieldPending; the coordinator owns the
   * dispatch of the resume turn (the tool does not need the payload).
   * Tests may stub it directly.
   */
  resolveYield?: (
    parentSessionKey: string,
    opts: SetYieldOpts,
  ) => SetYieldResult;
}
```

- [ ] **Step 2: Write failing tests**

Replace the placeholder `sessions_yield` block (if any) in `server/sessions/session-tools.test.ts`. Add:

```typescript
describe('sessions_yield', () => {
  const DEFAULT_TIMEOUT_TEXT = 'timeout = 600s';

  it('returns no-active-subs when registry reports none', async () => {
    const resolveYield = vi.fn().mockReturnValue({ setupOk: false, reason: 'no-active-subs' });
    const ctx = createMockContext({ resolveYield });
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_yield')!;

    const result = await tool.execute('call-1', {});
    expect(result.content[0].text).toContain('No sub-agents pending');
    expect(resolveYield).toHaveBeenCalledTimes(1);
  });

  it('returns already-pending when a yield is in progress', async () => {
    const resolveYield = vi.fn().mockReturnValue({ setupOk: false, reason: 'already-pending' });
    const ctx = createMockContext({ resolveYield });
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_yield')!;

    const result = await tool.execute('call-1', {});
    expect(result.content[0].text).toContain('Yield already pending');
  });

  it('reports active sub-agent count + timeout when registered', async () => {
    const resolveYield = vi.fn().mockReturnValue({ setupOk: true });
    const ctx = createMockContext({
      resolveYield,
      subAgentRegistry: {
        ...createMockContext().subAgentRegistry,
        listForParent: vi.fn().mockReturnValue([
          { status: 'running' },
          { status: 'running' },
          { status: 'completed' },
        ]),
      } as any,
    });
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_yield')!;

    const result = await tool.execute('call-1', {});
    expect(result.content[0].text).toContain('Yielded');
    expect(result.content[0].text).toContain('2 sub-agent');
    expect(result.content[0].text).toContain(DEFAULT_TIMEOUT_TEXT);
  });

  it('passes timeoutMs through to the registry', async () => {
    const resolveYield = vi.fn().mockReturnValue({ setupOk: true });
    const ctx = createMockContext({
      resolveYield,
      subAgentRegistry: {
        ...createMockContext().subAgentRegistry,
        listForParent: vi.fn().mockReturnValue([{ status: 'running' }]),
      } as any,
    });
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_yield')!;

    await tool.execute('call-1', { timeoutMs: 30_000 });

    const opts = (resolveYield as any).mock.calls[0][1];
    expect(opts.timeoutMs).toBe(30_000);
    expect(opts.parentAgentId).toBe('a1');
    expect(opts.parentRunId).toBe('run-1');
  });

  it('falls back to no-op text when ctx.resolveYield is undefined', async () => {
    const ctx = createMockContext({ resolveYield: undefined });
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_yield')!;

    const result = await tool.execute('call-1', {});
    expect(result.content[0].text).toContain('No sub-agents pending');
  });
});
```

- [ ] **Step 3: Run tests, confirm they fail**

Run: `npx vitest run server/sessions/session-tools.test.ts -t "sessions_yield"`
Expected: 5 tests FAIL.

- [ ] **Step 4: Rewrite `createSessionsYieldTool`**

Replace the existing yield tool factory in `server/sessions/session-tools.ts`:

```typescript
const YIELD_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function createSessionsYieldTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_yield',
    description:
      'End the current turn and wait for sub-agents spawned in this session to finish. Auto-resumes with their aggregated results as a new user turn. No-op when there are no running sub-agents. Optional timeoutMs (default 600000 = 10 min); on timeout the parent resumes with whatever results are available.',
    label: 'Sessions Yield',
    parameters: Type.Object({
      timeoutMs: Type.Optional(
        Type.Number({ description: 'Max wait before forced resume (default 600000)' }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        if (!ctx.resolveYield) {
          return textResult('No sub-agents pending; yield is a no-op.');
        }

        const timeoutMs = typeof params?.timeoutMs === 'number' && params.timeoutMs > 0
          ? params.timeoutMs
          : YIELD_DEFAULT_TIMEOUT_MS;

        const result = ctx.resolveYield(
          ctx.callerSessionKey,
          {
            parentAgentId: ctx.callerAgentId,
            parentRunId: ctx.callerRunId,
            timeoutMs,
          },
        );

        if (result.setupOk) {
          const running = ctx.subAgentRegistry
            .listForParent(ctx.callerSessionKey)
            .filter((r) => r.status === 'running').length;
          const timeoutSeconds = Math.round(timeoutMs / 1000);
          return textResult(
            `Yielded; will resume when ${running} sub-agent${running === 1 ? '' : 's'} complete (timeout = ${timeoutSeconds}s).`,
          );
        }

        if (result.reason === 'no-active-subs') {
          return textResult('No sub-agents pending; yield is a no-op.');
        }

        if (result.reason === 'already-pending') {
          return textResult('Yield already pending; ignoring.');
        }

        return textResult(`Could not yield: ${result.reason}`);
      } catch (e) {
        return textResult(`Error yielding: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}
```

- [ ] **Step 5: Run yield tests, confirm pass**

Run: `npx vitest run server/sessions/session-tools.test.ts -t "sessions_yield"`
Expected: 5 tests PASS.

- [ ] **Step 6: Run the full session-tools test file**

Run: `npx vitest run server/sessions/session-tools.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/sessions/session-tools.ts server/sessions/session-tools.test.ts
git commit -m "feat(sessions_yield): route through ctx.resolveYield with timeoutMs param"
```

---

## Task 6: Wire `resolveYield` from `RunCoordinator`

**Files:**
- Modify: `server/agents/run-coordinator.ts`

The coordinator constructs a `resolveYield` callback that:
1. Forwards to `subAgentRegistry.setYieldPending` with a closure that, on resolve:
   - Builds the aggregated user-message text from the payload.
   - Opens the parent's transcript via `transcriptStore.openSession` and appends the `sam.sub_agent_resume` custom entry, then snapshots.
   - Calls `this.dispatch({ sessionKey: parentSessionKey, text })` and ignores errors.

`destroy()` cancels any outstanding yield states so timers don't fire after shutdown.

- [ ] **Step 1: Update imports at the top of `server/agents/run-coordinator.ts`**

Add to the existing imports:

```typescript
import {
  RUN_DIAGNOSTIC_CUSTOM_TYPE,
  SUB_AGENT_RESUME_CUSTOM_TYPE,
  type RunDiagnosticData,
  type RunErrorDiagnosticData,
  type SubAgentResumeData,
  type SubAgentResumeResult,
} from '../../shared/session-diagnostics';
import type { ResumePayload, SetYieldResult } from './sub-agent-registry';
```

- [ ] **Step 2: Replace the `coordinatorLookup: () => null` line with full `resolveYield` wiring**

Locate the `SessionToolContext` construction in `executeRun` (around line 667-679):

```typescript
const sessionToolCtx: SessionToolContext = {
  callerSessionKey: record.sessionKey,
  callerAgentId: this.agentId,
  callerRunId: record.runId,
  sessionRouter: this.sessionRouter,
  storageEngine: this.storage,
  transcriptStore: this.transcriptStore,
  coordinator: this,
  subAgentRegistry: this.subAgentRegistry,
  coordinatorLookup: () => null, // Cross-agent lookup wired at server level later
  subAgentSpawning: this.config.tools?.subAgentSpawning ?? false,
  enabledToolNames: enabledSessionToolNames,
};
```

Replace with:

```typescript
const sessionToolCtx: SessionToolContext = {
  callerSessionKey: record.sessionKey,
  callerAgentId: this.agentId,
  callerRunId: record.runId,
  sessionRouter: this.sessionRouter,
  storageEngine: this.storage,
  transcriptStore: this.transcriptStore,
  coordinator: this,
  subAgentRegistry: this.subAgentRegistry,
  coordinatorLookup: () => null, // Cross-agent lookup wired at server level later
  subAgentSpawning: this.config.tools?.subAgentSpawning ?? false,
  enabledToolNames: enabledSessionToolNames,
  resolveYield: (parentSessionKey, opts): SetYieldResult => {
    const onResolve = (payload: ResumePayload) => {
      this.handleYieldResume(payload).catch((err) => {
        console.error('[RunCoordinator] yield resume failed:', err);
      });
    };
    return this.subAgentRegistry.setYieldPending(parentSessionKey, opts, onResolve);
  },
};
```

- [ ] **Step 3: Add the resume handler to `RunCoordinator`**

Insert the following methods inside the `RunCoordinator` class (after `manualCompact` is a good spot — keep them with other persistence-flavored helpers):

```typescript
/**
 * Build the aggregated user-message text + transcript marker for a
 * yield resume, persist the marker, then dispatch a synthetic user
 * turn against the parent's session. Errors are swallowed: a
 * deleted parent session simply means the resume is dropped.
 */
private async handleYieldResume(payload: ResumePayload): Promise<void> {
  if (!this.transcriptStore || !this.sessionRouter) return;

  const parent = await this.sessionRouter.getStatus(payload.parentSessionKey);
  if (!parent) return;

  const transcriptPath = this.storage!.resolveTranscriptPath(parent);
  const text = formatYieldResumeText(payload);
  const data: SubAgentResumeData = {
    generatedFromRunId: payload.parentRunId,
    reason: payload.reason,
    generatedAt: Date.now(),
    results: payload.results.map<SubAgentResumeResult>((r) => ({
      subAgentId: r.subAgentId,
      targetAgentId: r.targetAgentId,
      sessionKey: r.sessionKey,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationMs: r.durationMs,
      text: r.text,
      error: r.error,
    })),
  };

  try {
    const transcriptManager = this.transcriptStore.openSession(transcriptPath);
    transcriptManager.appendCustomEntry(SUB_AGENT_RESUME_CUSTOM_TYPE, data);
    await this.transcriptStore.snapshot(transcriptManager);
  } catch (err) {
    console.error('[RunCoordinator] failed to persist sam.sub_agent_resume entry:', err);
    // Continue and still dispatch — the marker is a UI hint, not load-bearing.
  }

  try {
    await this.dispatch({ sessionKey: payload.parentSessionKey, text });
  } catch (err) {
    console.error('[RunCoordinator] yield resume dispatch failed:', err);
  }
}
```

And at the bottom of the file (after `classifyError`), add the formatter helper:

```typescript
const YIELD_RESUME_PER_SUB_CAP = 1500;
const YIELD_RESUME_TOTAL_CAP = 8000;

function formatYieldResumeText(payload: ResumePayload): string {
  const header = `Sub-agents finished (N=${payload.results.length}, reason=${payload.reason}).`;
  const lines: string[] = [header, ''];

  let used = header.length + 1;
  for (let i = 0; i < payload.results.length; i++) {
    const r = payload.results[i];
    const durationSec = (r.durationMs / 1000).toFixed(1);
    const head = `[${i + 1}/${payload.results.length}] sub=${r.subAgentId.slice(0, 8)}... agent=${r.targetAgentId} status=${r.status} (${durationSec}s)`;
    const body = r.status === 'error'
      ? `error: ${r.error ?? 'unknown error'}`
      : truncateForResume(r.text ?? '', YIELD_RESUME_PER_SUB_CAP);

    const block = `${head}\n${body}`;
    if (used + block.length + 2 > YIELD_RESUME_TOTAL_CAP) {
      lines.push('…(truncated)');
      break;
    }
    lines.push(block);
    lines.push('');
    used += block.length + 2;
  }

  return lines.join('\n').trimEnd();
}

function truncateForResume(value: string, cap: number): string {
  if (value.length <= cap) return value;
  return `${value.slice(0, cap)}…(truncated)`;
}
```

- [ ] **Step 4: Cancel outstanding yields in `destroy()`**

Find the `destroy()` method (around line 494) and at the very top of the body, before the existing concurrency teardown, add:

```typescript
for (const record of this.runs.values()) {
  this.subAgentRegistry.cancelYield(record.sessionKey);
}
```

(Cancel by `sessionKey`; `cancelYield` is idempotent and a no-op when none is pending.)

- [ ] **Step 5: Typecheck the whole project**

Run: `npx tsc --noEmit`
Expected: No new errors. (The `coordinatorLookup` field is unchanged; only `resolveYield` is new.)

- [ ] **Step 6: Run the full server test suite**

Run: `npx vitest run server`
Expected: All tests PASS — including the new registry tests, session-tools tests, and any existing run-coordinator tests.

- [ ] **Step 7: Commit**

```bash
git add server/agents/run-coordinator.ts
git commit -m "feat(run-coordinator): wire resolveYield to dispatch sub-agent resume turn"
```

---

## Self-review

Spec coverage check (run after Task 6):

| Spec section | Implemented in |
|---|---|
| `sessions_yield` parameters (`timeoutMs`) | Task 5 Step 4 |
| Yield no-op when no subs | Task 5 (no-active-subs branch) |
| Yield already-pending no-op | Task 5 (already-pending branch) |
| Aggregated user-message text format | Task 6 (`formatYieldResumeText`) |
| `sam.sub_agent_resume` custom entry | Task 1 + Task 6 (`handleYieldResume`) |
| `SubAgentRegistry.setYieldPending` new signature | Task 2 |
| Timer-driven timeout resume | Task 2 |
| Idempotent resolve | Task 2 |
| `cancelYield` | Task 2 + Task 6 (destroy) |
| `sessions_list` `kind` / `recency` (existing) | unchanged |
| `sessions_list` `label` / `agent` / `preview` | Task 3 |
| `sessions_list` 50-session preview cap | Task 3 |
| `sessions_history` `limit` / `before` / `includeToolResults` | Task 4 |
| `sessions_history` per-entry caps (500 / 200) | Task 4 |
| `sessions_history` 12k total cap + `truncated` + `nextCursor` | Task 4 |
| `sessions_history` newest-first ordering | Task 4 |
| `sessions_history` JSON output shape | Task 4 |

No placeholders. No "TODO". No "implement later". Every code step shows the actual code.
