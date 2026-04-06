# Streaming & Reply Shaping — Layer 3 Design

<!-- last-verified: 2026-04-05 -->

This is the third of four layers that implement the full agent loop architecture described in `notes/agent.md`. Layer 1 introduced run dispatch, lifecycle tracking, `wait()`, timeout/abort handling. Layer 2 added queued execution, per-session serialization, and session write leases. Layer 3 adds multi-channel event streaming, reasoning gating, reply suppression, verbose tool summaries, compaction event support, and a frontend stream adapter.

## Layers Overview

1. Core Loop & Run Lifecycle
2. Concurrency & Session Serialization
3. **Streaming & Reply Shaping** (this spec)
4. Hooks & Plugin Lifecycle

## Problem

Layer 1 and 2 established run orchestration and concurrency. But the stream pipeline between `RunCoordinator` and the frontend is primitive:

- `EventBridge` does direct, unfiltered mapping from pi-agent-core events to WebSocket protocol events. There is no processing layer.
- pi-agent-core emits rich events (`thinking_start/delta/end`, `text_start/delta/end`, `toolcall_start/delta/end`, `tool_execution_update`) — most are dropped by EventBridge.
- No `NO_REPLY` / silent token filtering exists.
- No configurable reasoning stream gating.
- No verbose tool summary generation.
- No compaction stream events.
- No reply shaping (assembling final payloads from text + reasoning + inline tool summaries).
- ChatDrawer does inline event subscription and text buffering — no reusable abstraction.
- No fallback error reply logic when all payloads are suppressed but a tool errored.

## Decisions

- **Approach:** Composable pipeline — a new `StreamProcessor` orchestrates focused transform classes, each handling one concern.
- **Reasoning:** Thinking events are gated per agent via a `showReasoning` boolean config flag. When disabled, thinking events are silently dropped. When enabled, they are forwarded as `reasoning:start/delta/end` events and included in final payloads.
- **NO_REPLY suppression:** Two-layer detection. Early: on `text_end`, if the full text is exactly `NO_REPLY`/`no_reply` (trimmed), suppress the message event sequence and emit `message:suppressed`. Late: during final payload assembly, strip any matching text payload as a safety net.
- **Tool summaries:** Generation is controlled by a per-agent `verbose` boolean. When enabled, `tool:summary` events are emitted after each tool completes. Summaries are always collected as `RunPayload` items for the frontend to render or hide.
- **Compaction:** Event types and buffer-reset behavior are defined now. The actual compaction trigger is deferred to the context node / Layer 4.
- **Messaging tool dedup:** The `message:suppressed` event supports a `reason` field extensible for future `'messaging_tool_dedup'`. No implementation in this layer.
- **Frontend:** A `useChatStream` hook replaces inline event subscription in ChatDrawer. ChatDrawer becomes a pure renderer.
- **EventBridge simplification:** EventBridge becomes a thin WebSocket broadcaster. All event translation and processing moves to StreamProcessor.
- **Backwards compatibility:** StreamProcessor emits `agent:end` / `agent:error` alongside new lifecycle events, same as EventBridge does today.

## Assumptions

- `RunCoordinator` and `RunConcurrencyController` from Layers 1-2 are stable and unchanged by this layer.
- pi-agent-core's `AgentEvent` and `AssistantMessageEvent` type shapes are stable.
- `AgentConfig` is the single source of per-agent configuration. No runtime overrides for streaming behavior in this layer.
- The messaging tool does not exist yet. Dedup logic is defined but not triggered.
- Compaction triggers are owned by the context engine and Layer 4. This layer only handles the stream-side response to compaction events.

---

## 1. Architecture

### Data flow

```
RunCoordinator
  |  (raw CoordinatorEvents: lifecycle + stream wrapping pi-agent-core AgentEvents)
  v
StreamProcessor  <-- NEW
  |  (shaped ServerEvents: reasoning, deltas, tool summaries, suppression, compaction)
  v
EventBridge  (simplified -- just broadcasts shaped events to WebSockets)
```

### StreamProcessor (`server/agents/stream-processor.ts`)

One instance per managed agent, created alongside EventBridge. Subscribes to `RunCoordinator.subscribeAll()`. Runs events through the transform chain and emits shaped `ServerEvent`s.

Holds per-run state in a `Map<string, RunStreamContext>`. Context is created on `lifecycle:start` and cleaned up on terminal lifecycle events.

### Transform chain (ordered)

```
raw CoordinatorEvent
  -> ReasoningGate        (pass/drop thinking events per config)
  -> ReplyFilter          (detect NO_REPLY, emit suppression)
  -> ToolSummaryCollector (accumulate tool results, generate summaries when verbose)
  -> CompactionHandler    (handle compaction events, reset buffers on retry)
  -> ReplyAssembler       (assemble final RunPayload[], emit lifecycle payloads)
```

Each transform is a plain class with a `process(event, context, emit)` signature. `emit` forwards the event to the next stage or final output. Transforms are instantiated once per StreamProcessor and reused across runs — per-run state lives in `RunStreamContext`.

### AgentManager wiring

Creation order in `AgentManager.start()`:

```
1. AgentRuntime (unchanged)
2. RunCoordinator(agentId, runtime, config, storage)
3. StreamProcessor(agentId, coordinator, config)
4. EventBridge(agentId, streamProcessor)
```

`ManagedAgent` holds all four. `destroy()` tears down in reverse order.

---

## 2. RunStreamContext

Per-run mutable state created on `lifecycle:start`, cleaned up on terminal events.

```typescript
interface RunStreamContext {
  runId: string;
  textBuffer: string;
  reasoningBuffer: string;
  toolSummaries: ToolSummaryEntry[];
  noReplyDetected: boolean;
  messageSuppressed: boolean;
  compactionRetrying: boolean;
  payloads: RunPayload[];
  usage?: RunUsage;
}

interface ToolSummaryEntry {
  toolCallId: string;
  toolName: string;
  resultText: string;
  isError: boolean;
}
```

Created with all buffers empty, booleans `false`, arrays empty. `usage` is captured from `message_end` events.

---

## 3. Transforms

### 3.1 ReasoningGate

**File:** `server/agents/stream-transforms/reasoning-gate.ts`

**Input:** `message_update` events where `assistantMessageEvent.type` is `thinking_start`, `thinking_delta`, or `thinking_end`.

**Behavior:**
- If `config.showReasoning` is `false`: drop thinking events silently. Do not buffer.
- If `true`:
  - `thinking_start` -> emit `reasoning:start`
  - `thinking_delta` -> append delta to `context.reasoningBuffer`, emit `reasoning:delta`
  - `thinking_end` -> emit `reasoning:end` with full content

All non-thinking events pass through unchanged.

### 3.2 ReplyFilter

**File:** `server/agents/stream-transforms/reply-filter.ts`

**Input:** `message_update` events where `assistantMessageEvent.type` is `text_end`. Also observes `message_start` and all `text_delta` events.

**Early detection (stream-time):**
- On `text_end`: check if the full `content` string matches `NO_REPLY` or `no_reply` (exact match after `.trim()`). If so, set `context.noReplyDetected = true`.
- Once detected: suppress any pending `message:start`, all `message:delta`, and `message:end` emissions for this text block. Emit `message:suppressed` with `reason: 'no_reply'`. Set `context.messageSuppressed = true`.

**Buffering consideration:** ReplyFilter must buffer `message:start` and `text_delta` events and only forward them downstream once it confirms the text is *not* NO_REPLY (i.e., on `text_end` where the content doesn't match). If NO_REPLY is detected, the buffered events are discarded instead of forwarded.

**Text accumulation:** ReplyFilter always accumulates `text_delta` content into `context.textBuffer` regardless of whether the message is suppressed — this ensures ReplyAssembler has the full text for late detection. The difference is only in whether downstream `message:delta` events are emitted to the frontend.

**Late detection (payload-time):** Handled by ReplyAssembler during final payload assembly as a safety net.

**Future extension:** `reason: 'messaging_tool_dedup'` defined in the type but not triggered.

### 3.3 ToolSummaryCollector

**File:** `server/agents/stream-transforms/tool-summary-collector.ts`

**Input:** `tool_execution_end` events from pi-agent-core (via the `stream` coordinator event).

**Behavior:**
- Always: record tool result as a `ToolSummaryEntry` in `context.toolSummaries`.
- Always: pass through `tool_execution_start` and `tool_execution_end` events unchanged for EventBridge to broadcast as `tool:start` / `tool:end`.
- When `config.verbose` is `true`: additionally emit a `tool:summary` event with `toolName` and result text truncated at 500 chars.

### 3.4 CompactionHandler

**File:** `server/agents/stream-transforms/compaction-handler.ts`

**Input:** `memory_compaction` events from `RuntimeEvent` (already defined in `AgentRuntime`).

**Behavior:**
- On `memory_compaction`: emit `compaction:start`.
- Determine retry flag. In this layer: always `retrying: false` (trigger not built).
- If `retrying: true` (future): reset `textBuffer`, `reasoningBuffer`, `toolSummaries`, `noReplyDetected`, `messageSuppressed` on RunStreamContext. Emit `compaction:end` with `retrying: true`.
- If `retrying: false`: emit `compaction:end` with `retrying: false`. No buffer changes.

### 3.5 ReplyAssembler

**File:** `server/agents/stream-transforms/reply-assembler.ts`

**Input:** Terminal lifecycle events (`lifecycle:end`, `lifecycle:error`) and `message_end` events (for usage capture).

**On `message_end`:** capture usage from the event into `context.usage`.

**On `lifecycle:end`:**

1. Flush `context.textBuffer` into `{ type: 'text', content }` payload — skip if empty or if content (trimmed) is exactly `NO_REPLY`/`no_reply` (late detection safety net).
2. If `config.showReasoning` and `context.reasoningBuffer` non-empty: add `{ type: 'reasoning', content }` payload.
3. If `config.verbose`: add each tool summary as `{ type: 'tool_summary', content: '${toolName}: ${resultText}' }` payload.
4. If no renderable payloads remain and any `ToolSummaryEntry` has `isError: true`: emit fallback `{ type: 'error', content: 'Tool execution failed' }` payload.
5. Store assembled payloads in `context.payloads`. Push payloads and usage back to `RunCoordinator` via `setRunPayloads(runId, payloads, usage)`.
6. Emit the enriched `lifecycle:end` event with payloads and usage attached.

**On `lifecycle:error`:** pass through unchanged.

---

## 4. EventBridge Changes

EventBridge becomes a thin WebSocket broadcaster.

**Constructor:** takes `(agentId, streamProcessor)` instead of `(agentId, coordinator)`.

**Subscribes to:** StreamProcessor output (already-shaped `ServerEvent`s).

**Removed:**
- `handleCoordinatorEvent()` — all event translation moves to StreamProcessor
- `handleStreamEvent()` — same

**Kept:**
- `addSocket()` / `removeSocket()` / `destroy()` — unchanged
- `broadcast(event: ServerEvent)` — unchanged

**Backwards-compat emissions** (`agent:end`, `agent:error`) move to StreamProcessor, which emits them alongside new lifecycle events.

---

## 5. RunCoordinator Changes

Minimal changes to keep the coordinator focused on lifecycle orchestration.

### Removed from `executeRun()`

- `textBuffer` accumulation from `message_update` events
- `tool_summary` push from `tool_execution_end` events
- Usage capture from `message_end` events

All of this moves to StreamProcessor's transforms.

### New method

```typescript
setRunPayloads(runId: string, payloads: RunPayload[], usage?: RunUsage): void
```

Called by ReplyAssembler after final payload assembly. Updates the `RunRecord` so `wait()` still returns shaped payloads.

### `lifecycle:end` emission

RunCoordinator emits `lifecycle:end` with empty payloads. StreamProcessor intercepts, attaches assembled payloads, and emits the enriched version downstream.

---

## 6. Protocol Changes

### New WebSocket events (backend -> frontend)

```typescript
interface ReasoningStartEvent {
  type: 'reasoning:start';
  agentId: string;
  runId: string;
}

interface ReasoningDeltaEvent {
  type: 'reasoning:delta';
  agentId: string;
  runId: string;
  delta: string;
}

interface ReasoningEndEvent {
  type: 'reasoning:end';
  agentId: string;
  runId: string;
  content: string;
}

interface MessageSuppressedEvent {
  type: 'message:suppressed';
  agentId: string;
  runId: string;
  reason: 'no_reply' | 'messaging_tool_dedup';
}

interface CompactionStartEvent {
  type: 'compaction:start';
  agentId: string;
  runId: string;
}

interface CompactionEndEvent {
  type: 'compaction:end';
  agentId: string;
  runId: string;
  retrying: boolean;
}

interface ToolSummaryEvent {
  type: 'tool:summary';
  agentId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
}
```

### Modified types

**`RunPayload`** — new `'reasoning'` type:

```typescript
interface RunPayload {
  type: 'text' | 'reasoning' | 'tool_summary' | 'error';
  content: string;
}
```

**`ServerEvent` union** — add the seven new event interfaces.

**`AgentConfig`** — two new optional fields:

```typescript
showReasoning?: boolean;  // default false
verbose?: boolean;        // default false
```

### Unchanged

- `CoordinatorEvent` — RunCoordinator still emits raw events
- `Command` — no new commands
- `DispatchParams` / `WaitResult` — wait returns shaped `RunPayload[]` (now including reasoning), but the interface is unchanged

---

## 7. Config & Node Changes

### AgentConfig

Two new optional top-level fields:

```typescript
showReasoning?: boolean;  // default false
verbose?: boolean;        // default false
```

Top-level because they affect the stream pipeline, not a specific peripheral node.

### Agent node data (`src/types/nodes.ts`)

Add to `AgentNodeData`:

```typescript
showReasoning?: boolean;
verbose?: boolean;
```

### Default values (`src/utils/default-nodes.ts`)

Both default to `false` in the agent node defaults.

### Config resolution (`src/utils/graph-to-agent.ts`)

Direct boolean pass-through to `AgentConfig`. No transformation needed.

### Property editor

The agent node's property editor gains two toggles:
- "Show reasoning" — note: only effective with models that support thinking/extended thinking
- "Verbose tool output" — note: adds tool result summaries to the chat stream

---

## 8. Frontend — ChatStreamAdapter

### `useChatStream` hook (`src/chat/useChatStream.ts`)

Reactive hook that replaces inline event subscription in ChatDrawer.

```typescript
interface ChatStreamState {
  isStreaming: boolean;
  reasoning: string | null;
  isReasoning: boolean;
  suppressedReply: boolean;
  compacting: boolean;
  toolSummaries: ToolSummaryInfo[];
}

interface ToolSummaryInfo {
  toolCallId: string;
  toolName: string;
  summary: string;
}
```

### Event handling

- **`message:start/delta/end`** — delegates to `useSessionStore.addMessage/updateMessage`. Sets `isStreaming`.
- **`reasoning:start/delta/end`** — accumulates reasoning text, exposes via `reasoning` and `isReasoning`. Clears on next `message:start`.
- **`message:suppressed`** — sets `suppressedReply = true`, removes partial assistant message from session store if one was started.
- **`tool:summary`** — appends to `toolSummaries`.
- **`compaction:start/end`** — toggles `compacting` flag.
- **`lifecycle:end` / `agent:end`** — resets streaming state, clears transient fields.
- **`agent:error` / `lifecycle:error`** — adds error message to session, resets state.

### ChatDrawer changes

- Removes `agentClient.onEvent` subscription, `assistantContent` buffer, `unsubRef` tracking
- Calls `useChatStream(agentNodeId)` and renders from its state
- Reasoning display, compaction indicator, and tool summaries become conditional UI elements
- Detailed UI for these elements is out of scope — minimal/placeholder rendering

### Responsibility split

- `useChatStream` owns the **stream lifecycle** (subscriptions, buffering, state transitions)
- `ChatDrawer` owns the **chat UX** (session management, input handling, message rendering, context usage)

---

## 9. Testing Strategy

### Unit tests — transforms (one test file per transform)

**ReasoningGate:**
- Passes thinking events when `showReasoning: true`, drops when `false`
- Non-thinking events always pass through unchanged

**ReplyFilter:**
- Detects exact `NO_REPLY` / `no_reply` (trimmed) on `text_end`, sets flag
- Suppresses message events after detection, emits `message:suppressed`
- Passes normal text through unchanged
- Partial matches (e.g., `"NO_REPLY but more text"`) are not suppressed

**ToolSummaryCollector:**
- Always records tool results in context
- Emits `tool:summary` when `verbose: true`, doesn't when `false`
- Truncates summary content at 500 chars
- Tool start/end events pass through unchanged

**CompactionHandler:**
- Emits `compaction:start` and `compaction:end` on `memory_compaction` events
- When `retrying: true` (future): resets all buffers on RunStreamContext
- When `retrying: false`: no buffer changes

**ReplyAssembler:**
- Assembles text + reasoning + tool_summary payloads on `lifecycle:end`
- Strips NO_REPLY text payloads (late detection safety net)
- Emits fallback error payload when no renderable payloads and a tool errored
- Omits reasoning payload when `showReasoning: false`

### Integration tests — StreamProcessor

- Full pipeline: raw pi-agent-core events in -> shaped ServerEvents out
- Multi-turn: context resets between runs
- NO_REPLY with reasoning: reasoning payload preserved, text payload stripped
- Verbose + NO_REPLY: tool summaries preserved, text suppressed

### Frontend — useChatStream

- Reasoning state transitions: `isReasoning` toggles correctly across start/delta/end
- Suppression: partial message cleaned up on `message:suppressed`
- Compaction flag toggles
- Cleanup on lifecycle end/error

### Not tested in this layer

- Actual compaction triggers (Layer 4)
- Messaging tool dedup (future)
- WebSocket serialization (EventBridge is too thin to warrant dedicated tests beyond existing coverage)

---

## 10. Files Changed / Created

### New files

| File | Purpose |
|------|---------|
| `server/agents/stream-processor.ts` | Orchestrates transform chain, per-run context management |
| `server/agents/stream-transforms/reasoning-gate.ts` | Gates thinking events per config |
| `server/agents/stream-transforms/reply-filter.ts` | NO_REPLY detection and message suppression |
| `server/agents/stream-transforms/tool-summary-collector.ts` | Tool result collection and verbose summary emission |
| `server/agents/stream-transforms/compaction-handler.ts` | Compaction event handling and buffer reset |
| `server/agents/stream-transforms/reply-assembler.ts` | Final payload assembly |
| `src/chat/useChatStream.ts` | Frontend stream adapter hook |

### Modified files

| File | Change |
|------|--------|
| `server/agents/event-bridge.ts` | Simplified to thin broadcaster, subscribes to StreamProcessor |
| `server/agents/run-coordinator.ts` | Remove payload buffering, add `setRunPayloads()` |
| `server/agents/agent-manager.ts` | Wire StreamProcessor in creation/destruction |
| `shared/protocol.ts` | Add 7 new event interfaces, update `ServerEvent` union |
| `shared/run-types.ts` | Add `'reasoning'` to `RunPayload.type` |
| `shared/agent-config.ts` | Add `showReasoning`, `verbose` fields |
| `src/types/nodes.ts` | Add `showReasoning`, `verbose` to `AgentNodeData` |
| `src/utils/default-nodes.ts` | Add defaults for new fields |
| `src/utils/graph-to-agent.ts` | Pass through new config fields |
| `src/chat/ChatDrawer.tsx` | Replace inline subscription with `useChatStream` hook |
| `src/panels/property-editors/` | Add toggles for new config fields |

### Unchanged

| File | Reason |
|------|--------|
| `server/runtime/agent-runtime.ts` | Still a thin pi-agent-core wrapper |
| `server/agents/run-concurrency-controller.ts` | Concurrency is orthogonal to streaming |
| `shared/storage-types.ts` | No storage changes in this layer |
