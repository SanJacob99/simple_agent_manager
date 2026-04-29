# Session Tools: Yield Orchestration, List Filters, History Pagination

**Date:** 2026-04-29
**Scope:** Upgrades to three agent-facing session tools — `sessions_yield`, `sessions_list`, `sessions_history`.
**Builds on:** [2026-04-07-session-deferred-features-design.md](2026-04-07-session-deferred-features-design.md), which introduced the seven session tools and `SubAgentRegistry`.

## Overview

The session tools shipped in the prior spec are partially load-bearing. Three of them are agent-facing surfaces with concrete gaps:

1. **`sessions_yield`** sets a flag in `SubAgentRegistry` but nothing consumes it — the parent never resumes when sub-agents finish.
2. **`sessions_list`** supports only `kind` and `recency`. The agent has no way to filter by a session's `displayName`, scope to a specific agent, or opt into a content preview.
3. **`sessions_history`** returns every entry in the transcript with a per-entry 500-char cap and no overall budget — long sessions blow the agent's context.

This spec closes those three gaps. All other session tools (`sessions_send`, `sessions_spawn`, `subagents`, `session_status`) are unchanged. Cross-agent `coordinatorLookup` wiring stays out of scope.

## Tool 1 — `sessions_yield` becomes async orchestration

### Behavior

`sessions_yield` is invoked by the agent after spawning sub-agents in this turn (or earlier). It signals "I'm done for now; resume me when my sub-agents finish."

The runtime model is **async resume**:

1. The current turn ends cleanly. The parent's run completes from the UI's perspective.
2. A timer + completion watcher in `SubAgentRegistry` waits for every running sub-agent under the caller's `parentSessionKey` to reach a terminal status.
3. When all are done (or a safety timeout fires), the registry builds a `ResumePayload` with `reason` and `results` and calls `resolveFn`. The coordinator's `onResolve` callback (wired by `RunCoordinator`) reads `results` to format the aggregated user-message text and dispatch the synthetic resume turn. A side-channel custom transcript entry allows the UI to render the resume distinctively (instead of as a generic user message).

### Parameters

```ts
{
  timeoutMs?: number;   // default 10 * 60 * 1000 = 600_000 (10 minutes)
}
```

### Edge cases

- **No sub-agents pending.** Tool returns `text: 'No sub-agents pending; yield is a no-op.'` and does NOT set the yield flag. The turn ends normally.
- **Yield already pending for this parent.** Second call returns `text: 'Yield already pending; ignoring.'` (no-op).
- **A sub-agent errors or times out.** Resume still fires; the per-sub `status` is `'error'` and `error: <message>` is included in the aggregated text and structured payload.
- **Safety timeout fires before all subs finish.** Resume fires anyway with `reason: 'timeout'`. Any still-running sub-agent appears in the structured results with `status: 'running'`. The sub-agents themselves keep running and complete normally; the registry no longer waits on them once the timeout has resolved the yield.
- **Parent run already ended.** Doesn't matter — `dispatch()` simply enqueues a new run. The parent reasons about results in that next turn.
- **Parent session deleted.** Catch the `dispatch` error, log, drop the yield silently.

### Aggregated user-message text (what the model sees)

```
Sub-agents finished (N=3, reason=all-complete).

[1/3] sub=4f2a... agent=research_bot status=completed (12.4s)
<last assistant text, truncated to 1500 chars>

[2/3] sub=89cd... agent=research_bot status=error (3.1s)
error: timeout

[3/3] sub=01ba... agent=research_bot status=completed (8.0s)
<text>
```

Per-sub cap: 1500 chars. Total text cap: 8000 chars. Overflow gets `…(truncated)`.

### Custom transcript entry — `sam.sub_agent_resume`

Persisted on the parent's transcript immediately before the synthetic user turn. The UI uses it as a hint to render the next user message as a "Sub-agent results" pill instead of a normal user bubble. The entry is informational — it is NOT replayed into the LLM context (consistent with how `sam.system_prompt` is handled today).

```ts
// shared/session-diagnostics.ts additions
export const SUB_AGENT_RESUME_CUSTOM_TYPE = 'sam.sub_agent_resume';

export interface SubAgentResumeData {
  generatedFromRunId: string;     // the parent run that called sessions_yield
  reason: 'all-complete' | 'timeout';
  generatedAt: number;
  results: SubAgentResumeResult[];
}

export interface SubAgentResumeResult {
  subAgentId: string;
  targetAgentId: string;
  sessionKey: string;
  status: 'completed' | 'error' | 'running';   // 'running' only on timeout
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  text?: string;
  error?: string;
}
```

## Tool 2 — `sessions_list` filters

### Parameters

```ts
{
  kind?: 'all' | 'agent' | 'cron';   // unchanged; default 'all'
  recency?: number;                  // unchanged; minutes
  label?: string;                    // NEW — substring, case-insensitive, matches displayName
  agent?: string;                    // NEW — exact agentId; default = caller's agentId
  preview?: boolean;                 // NEW — default false
}
```

### Filter pipeline

1. **Source.** Use `SessionRouter.listSessions()` as today — it's already caller-scoped via `agentId`. (Note: `StorageEngine` is also caller-scoped, since it's constructed per agent. True cross-agent listing requires the multi-agent registry that's gated behind cross-agent `coordinatorLookup`, which is out of scope here.)
2. **`agent` filter.** When unset, behave as today (caller's sessions). When set, validate `agent === ctx.callerAgentId`; if it differs, return an explicit text result: `Cross-agent listing is not yet supported; only the caller's own agentId is accepted.`. Keeping the parameter in the schema makes the future cross-agent extension a pure capability lift.
3. **`kind` filter.** Prefix match on `sessionKey` — `agent:` for `'agent'`, `cron:` for `'cron'`. `'all'` is a passthrough.
4. **`recency` filter.** `s.updatedAt >= cutoffISO` (lexical compare against `(now - recency*60_000).toISOString()`, matching today's behavior).
5. **`label` filter.** When set: `s.displayName?.toLowerCase().includes(label.toLowerCase()) === true`. Sessions without `displayName` are excluded when `label` is provided.

### Output shape

Default (no `preview` or `preview: false`) — unchanged from today:

```json
{ "sessionKey", "sessionId", "chatType", "updatedAt", "totalTokens", "displayName" }
```

With `preview: true`, each result also gets:

```json
{
  "preview": "<first user-message text, ≤120 chars>",
  "messageCount": 14
}
```

### Cost guard for `preview: true`

Reading transcripts is O(file size) per session. Cap the post-filter list at 50 sessions before transcript reads when `preview: true` is set; the tool description explicitly states this cap so agents know to narrow with other filters. Reads are sequential.

## Tool 3 — `sessions_history` pagination & budget

### Parameters

```ts
{
  sessionKey: string;
  limit?: number;                   // default 20, max 200
  before?: string;                  // entryId cursor; entries strictly older than this id
  includeToolResults?: boolean;     // default true
}
```

### Selection algorithm

1. Read the full transcript via `transcriptStore.readTranscript(transcriptPath)`.
2. Filter to `entry.type ∈ {message, toolResult}`. Drop `toolResult` entries if `includeToolResults: false`. Drop all other entry types (compactions, model changes, custom entries).
3. If `before` is set, find the entry with matching `id`. If not found, return `text: 'Cursor not found: <before>'` as the tool result. Otherwise slice to entries strictly older (lower index in the chronological list).
4. Take the last `min(limit, 200)` entries from that slice. Reverse to newest-first.

### Truncation budgets

- **Per-entry caps.** Messages: 500 chars. ToolResult content / toolCall blocks inside assistant messages: 200 chars. Truncation marker: `…(truncated)`.
- **Total response cap.** 12 000 chars across the page. While building newest-first, stop adding entries once the next would push the rendered JSON past the cap; mark `truncated: true`.

### Output shape

Single text payload containing JSON:

```json
{
  "sessionKey": "agent:a1:main",
  "entries": [
    {
      "id": "e123",
      "type": "message",
      "role": "assistant",
      "timestamp": "2026-04-29T12:30:00.000Z",
      "text": "..."
    },
    {
      "id": "e122",
      "type": "toolResult",
      "toolName": "web_search",
      "timestamp": "2026-04-29T12:29:55.000Z",
      "text": "..."
    }
  ],
  "nextCursor": "e103",
  "truncated": false,
  "totalEntries": 234
}
```

`nextCursor` is the oldest `entryId` in the returned page — the value to pass as `before` for the next page. Omit `nextCursor` when the page reached the start of the transcript.

`totalEntries` reflects the count *after* filtering by type/`includeToolResults` but *before* the cursor slice — gives the agent a sense of how much history exists.

## SubAgentRegistry changes

The registry's yield model is rewritten from a boolean flag to a stateful coordinator that owns the timer and the resolve callback.

### Type changes

```ts
// server/agents/sub-agent-registry.ts

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

export interface ResumePayload {
  parentSessionKey: string;
  parentAgentId: string;
  parentRunId: string;
  results: ResumeResult[];                     // see below
  reason: 'all-complete' | 'timeout';
}
```

### Method changes

```ts
// Replaces setYieldPending(string)
setYieldPending(
  parentSessionKey: string,
  opts: { parentAgentId: string; parentRunId: string; timeoutMs: number },
  resolve: (payload: ResumePayload) => void,
): { setupOk: boolean; reason?: 'no-active-subs' | 'already-pending' };

cancelYield(parentSessionKey: string): void;
```

`onComplete` / `onError` / `kill` each call a new private `maybeResolveYield(parentSessionKey)` after marking a record terminal. That helper:

1. Looks up the `YieldState` for the parent. If none, return.
2. Skips if `resolved` is already true (idempotent).
3. Counts running children for that parent. If `> 0`, return.
4. Builds a `ResumePayload` with `reason: 'all-complete'` and `results` (current child records) and calls `resolve`. Marks `resolved: true`. Clears the timer. Text formatting from `results` is the coordinator's responsibility, not the registry's.

The timer fires `maybeResolveOnTimeout(parentSessionKey)`, which builds a payload from current child statuses (some may be `'running'`) with `reason: 'timeout'` and calls `resolve` once, idempotently.

### Sub-agent text source

`SubAgentRecord.result` already holds the final assistant text (set by `RunCoordinator.finalizeRunSuccess` for `sub:` keys). The registry uses that string for `results[i].text`, truncated to 1500 chars per entry.

## RunCoordinator wiring

### Building the resolve callback

In `executeRun`, when constructing `SessionToolContext`, the coordinator passes a `resolveYield` callback:

```ts
const resolveYield = (payload: ResumePayload): void => {
  // 1. Persist the custom transcript entry on the parent's transcript.
  // 2. Dispatch the synthetic user turn back to this coordinator.
  // 3. On dispatch failure (deleted session), log and drop.
};
```

The callback is closed over `this` so it always dispatches against the *parent's* coordinator (the one running the parent's session). For yields against the same agent — the only path supported until cross-agent `coordinatorLookup` is wired — that's just `this.dispatch(...)`.

### Synthetic user turn

```ts
await this.dispatch({
  sessionKey: payload.parentSessionKey,
  text: payload.text,
  // No attachments; resume turns are text-only.
});
```

The `sam.sub_agent_resume` custom entry is appended to the transcript file *before* dispatch using `transcriptStore.openSession(transcriptPath)` + `appendCustomEntry` + `transcriptStore.snapshot()`. Done synchronously (awaited) before the dispatch so the UI never shows the user message ahead of the marker entry.

### Cleanup

`RunCoordinator.destroy()` walks active yield states and calls `subAgentRegistry.cancelYield(...)` for each parent it owns, clearing timers.

### `SessionToolContext` extension

```ts
export interface SessionToolContext {
  // existing fields...
  resolveYield?: (
    parentSessionKey: string,
    opts: SetYieldOpts,
  ) => SetYieldResult;
}
```

`createSessionsYieldTool` uses `ctx.resolveYield` to register; the coordinator-supplied implementation forwards to `subAgentRegistry.setYieldPending` and wires the resume dispatch as the `onResolve` callback. The tool maps the registry's return value to the agent-facing text:

| `setupOk` | `reason` | Tool result text |
|---|---|---|
| `true` | (n/a) | `Yielded; will resume when N sub-agents complete (timeout = Xs).` |
| `false` | `'no-active-subs'` | `No sub-agents pending; yield is a no-op.` |
| `false` | `'already-pending'` | `Yield already pending; ignoring.` |

When `ctx.resolveYield` is undefined (e.g., older callers / tests that didn't wire it), the tool returns the distinct text `'Yield is not available in this context; ignoring.'` and never registers. The wording differs from the `no-active-subs` message so an agent (or log reader) can tell a wiring gap apart from a legitimate empty-children state.

## Tests

### `server/sessions/session-tools.test.ts` additions

- `sessions_list` with `label`: matches case-insensitively; excludes sessions without `displayName`.
- `sessions_list` with `agent`: returns only the named agent's sessions.
- `sessions_list` with `preview: true`: result entries carry `preview` and `messageCount`; cap of 50 sessions enforced.
- `sessions_history` newest-first ordering.
- `sessions_history` `before` cursor: bad cursor returns explicit error; good cursor pages.
- `sessions_history` total budget cap: long transcript truncates with `truncated: true` and a valid `nextCursor`.
- `sessions_history` `includeToolResults: false`: tool results excluded.
- `sessions_yield` no-op when no active subs.
- `sessions_yield` registers when subs are active.
- `sessions_yield` second call is a no-op.

### `server/agents/sub-agent-registry.test.ts` (new file)

- `setYieldPending` returns `setupOk: false` with `reason: 'no-active-subs'` when no children.
- `setYieldPending` then `onComplete` of last running child triggers `resolve` with `reason: 'all-complete'`.
- `setYieldPending` then timeout triggers `resolve` with `reason: 'timeout'` and any still-running child reported with `status: 'running'`.
- `cancelYield` clears the timer and prevents resolve from firing.
- Double-`onComplete` does not double-resolve.
- Re-entry of `setYieldPending` for an already-pending parent returns `setupOk: false` with `reason: 'already-pending'`.

## Files touched

### Modified

| File | Change |
|---|---|
| `server/sessions/session-tools.ts` | Update `createSessionsListTool`, `createSessionsHistoryTool`, `createSessionsYieldTool`. Add helpers for total-budget formatting, preview extraction. `sessions_list` continues to source from `SessionRouter.listSessions()`; add caller-scoped enforcement for the `agent` parameter. |
| `server/agents/sub-agent-registry.ts` | Replace boolean `yieldPending` set with `Map<string, YieldState>`. Add `cancelYield`, internal `maybeResolveYield`, timer wiring. Update `setYieldPending` signature. |
| `server/agents/run-coordinator.ts` | Pass `resolveYield` into `SessionToolContext`. On resolve, persist `sam.sub_agent_resume` custom entry then `dispatch` the synthetic user turn. Cancel yields in `destroy()`. |
| `server/sessions/session-tools.test.ts` | New cases (see Tests section). |
| `shared/session-diagnostics.ts` | Add `SUB_AGENT_RESUME_CUSTOM_TYPE` and `SubAgentResumeData` / `SubAgentResumeResult`. |

### New

| File | Change |
|---|---|
| `server/agents/sub-agent-registry.test.ts` | Yield-resolve, timeout, idempotency, cancel, no-active-subs cases. |

### Docs

No concept-doc updates required — these tools aren't surfaced in `docs/concepts/` (which covers node types, not tool surfaces).
