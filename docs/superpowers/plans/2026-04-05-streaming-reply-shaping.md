# Streaming & Reply Shaping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a composable stream processing pipeline between RunCoordinator and EventBridge that gates reasoning events, detects NO_REPLY suppression, generates verbose tool summaries, handles compaction events, and assembles shaped final payloads — plus a frontend hook that replaces ChatDrawer's inline event subscription.

**Architecture:** A new `StreamProcessor` class subscribes to raw `CoordinatorEvent`s and pipes them through five ordered transforms (ReasoningGate, ReplyFilter, ToolSummaryCollector, CompactionHandler, ReplyAssembler). Each transform is a plain class with `process(event, context, emit)`. EventBridge is simplified to a thin broadcaster that subscribes to StreamProcessor output. A `useChatStream` hook replaces ChatDrawer's inline event subscription.

**Tech Stack:** TypeScript, Vitest, React 19, Zustand, @mariozechner/pi-agent-core

**Spec:** `docs/superpowers/specs/2026-04-05-streaming-reply-shaping-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `server/agents/stream-transforms/types.ts` | Shared types: `RunStreamContext`, `ToolSummaryEntry`, `StreamTransform` interface |
| `server/agents/stream-transforms/reasoning-gate.ts` | Gates thinking events per `showReasoning` config |
| `server/agents/stream-transforms/reasoning-gate.test.ts` | Unit tests for ReasoningGate |
| `server/agents/stream-transforms/reply-filter.ts` | NO_REPLY detection and message suppression |
| `server/agents/stream-transforms/reply-filter.test.ts` | Unit tests for ReplyFilter |
| `server/agents/stream-transforms/tool-summary-collector.ts` | Tool result collection and verbose summary emission |
| `server/agents/stream-transforms/tool-summary-collector.test.ts` | Unit tests for ToolSummaryCollector |
| `server/agents/stream-transforms/compaction-handler.ts` | Compaction event handling and buffer reset |
| `server/agents/stream-transforms/compaction-handler.test.ts` | Unit tests for CompactionHandler |
| `server/agents/stream-transforms/reply-assembler.ts` | Final payload assembly |
| `server/agents/stream-transforms/reply-assembler.test.ts` | Unit tests for ReplyAssembler |
| `server/agents/stream-processor.ts` | Orchestrates transform chain, per-run context management |
| `server/agents/stream-processor.test.ts` | Integration tests for full pipeline |
| `src/chat/useChatStream.ts` | Frontend stream adapter hook |

### Modified files

| File | Change |
|------|--------|
| `shared/run-types.ts` | Add `'reasoning'` to `RunPayload.type` |
| `shared/protocol.ts` | Add 7 new event interfaces, update `ServerEvent` union |
| `shared/agent-config.ts` | Add `showReasoning`, `verbose` fields to `AgentConfig` |
| `src/types/nodes.ts` | Add `showReasoning`, `verbose` to `AgentNodeData` |
| `src/utils/default-nodes.ts` | Add defaults for new fields |
| `src/utils/graph-to-agent.ts` | Pass through new config fields |
| `server/agents/run-coordinator.ts` | Remove payload buffering from `executeRun()`, add `setRunPayloads()` |
| `server/agents/event-bridge.ts` | Simplify to thin broadcaster subscribing to StreamProcessor |
| `server/agents/agent-manager.ts` | Wire StreamProcessor into creation/destruction chain |
| `src/panels/property-editors/AgentProperties.tsx` | Add Show Reasoning and Verbose toggles |
| `src/chat/ChatDrawer.tsx` | Replace inline event subscription with `useChatStream` hook |
| `server/agents/event-bridge.test.ts` | Update tests for new StreamProcessor-based constructor |

---

## Task 1: Shared Types — Protocol Events & Config

**Files:**
- Modify: `shared/run-types.ts:33-36`
- Modify: `shared/protocol.ts:1-200`
- Modify: `shared/agent-config.ts:84-108`

- [ ] **Step 1: Add `'reasoning'` to `RunPayload.type`**

In `shared/run-types.ts`, change:

```typescript
export interface RunPayload {
  type: 'text' | 'tool_summary' | 'error';
  content: string;
}
```

to:

```typescript
export interface RunPayload {
  type: 'text' | 'reasoning' | 'tool_summary' | 'error';
  content: string;
}
```

- [ ] **Step 2: Add new event interfaces to `shared/protocol.ts`**

Add before the `ServerEvent` union:

```typescript
export interface ReasoningStartEvent {
  type: 'reasoning:start';
  agentId: string;
  runId: string;
}

export interface ReasoningDeltaEvent {
  type: 'reasoning:delta';
  agentId: string;
  runId: string;
  delta: string;
}

export interface ReasoningEndEvent {
  type: 'reasoning:end';
  agentId: string;
  runId: string;
  content: string;
}

export interface MessageSuppressedEvent {
  type: 'message:suppressed';
  agentId: string;
  runId: string;
  reason: 'no_reply' | 'messaging_tool_dedup';
}

export interface CompactionStartEvent {
  type: 'compaction:start';
  agentId: string;
  runId: string;
}

export interface CompactionEndEvent {
  type: 'compaction:end';
  agentId: string;
  runId: string;
  retrying: boolean;
}

export interface ToolSummaryEvent {
  type: 'tool:summary';
  agentId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  summary: string;
}
```

- [ ] **Step 3: Update the `ServerEvent` union**

Add all seven new types to the union:

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
  | LifecycleErrorEvent
  | ReasoningStartEvent
  | ReasoningDeltaEvent
  | ReasoningEndEvent
  | MessageSuppressedEvent
  | CompactionStartEvent
  | CompactionEndEvent
  | ToolSummaryEvent;
```

- [ ] **Step 4: Add `showReasoning` and `verbose` to `AgentConfig`**

In `shared/agent-config.ts`, add to the `AgentConfig` interface after `runTimeoutMs`:

```typescript
  showReasoning?: boolean;
  verbose?: boolean;
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add shared/run-types.ts shared/protocol.ts shared/agent-config.ts
git commit -m "feat: add streaming & reply shaping protocol types and config fields"
```

---

## Task 2: Node Types, Defaults & Config Resolution

**Files:**
- Modify: `src/types/nodes.ts:20-33`
- Modify: `src/utils/default-nodes.ts:7-19`
- Modify: `src/utils/graph-to-agent.ts:198-219`

- [ ] **Step 1: Add fields to `AgentNodeData`**

In `src/types/nodes.ts`, add to `AgentNodeData` after `systemPromptMode`:

```typescript
  showReasoning: boolean;
  verbose: boolean;
```

- [ ] **Step 2: Add defaults**

In `src/utils/default-nodes.ts`, add to the agent case after `systemPromptMode`:

```typescript
        showReasoning: false,
        verbose: false,
```

- [ ] **Step 3: Pass through in config resolution**

In `src/utils/graph-to-agent.ts`, add to the return object after `runTimeoutMs: 172800000,`:

```typescript
    showReasoning: data.showReasoning ?? false,
    verbose: data.verbose ?? false,
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/types/nodes.ts src/utils/default-nodes.ts src/utils/graph-to-agent.ts
git commit -m "feat: add showReasoning and verbose to agent node data and config resolution"
```

---

## Task 3: Transform Types & RunStreamContext

**Files:**
- Create: `server/agents/stream-transforms/types.ts`

- [ ] **Step 1: Create the shared types file**

Create `server/agents/stream-transforms/types.ts`:

```typescript
import type { RunPayload, RunUsage, CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

export interface ToolSummaryEntry {
  toolCallId: string;
  toolName: string;
  resultText: string;
  isError: boolean;
}

export interface RunStreamContext {
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

export type EmitFn = (event: ServerEvent) => void;

export interface StreamTransform {
  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void;
}

export function createRunStreamContext(runId: string): RunStreamContext {
  return {
    runId,
    textBuffer: '',
    reasoningBuffer: '',
    toolSummaries: [],
    noReplyDetected: false,
    messageSuppressed: false,
    compactionRetrying: false,
    payloads: [],
    usage: undefined,
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add server/agents/stream-transforms/types.ts
git commit -m "feat: add stream transform shared types and RunStreamContext"
```

---

## Task 4: ReasoningGate Transform

**Files:**
- Create: `server/agents/stream-transforms/reasoning-gate.ts`
- Create: `server/agents/stream-transforms/reasoning-gate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/agents/stream-transforms/reasoning-gate.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ReasoningGate } from './reasoning-gate';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function streamEvent(assistantMessageEvent: any): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: { type: 'message_update', assistantMessageEvent },
  };
}

describe('ReasoningGate', () => {
  it('drops thinking events when showReasoning is false', () => {
    const gate = new ReasoningGate(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    gate.process(
      streamEvent({ type: 'thinking_start', contentIndex: 0, partial: {} }),
      ctx,
      emit,
    );
    gate.process(
      streamEvent({ type: 'thinking_delta', contentIndex: 0, delta: 'hmm', partial: {} }),
      ctx,
      emit,
    );
    gate.process(
      streamEvent({ type: 'thinking_end', contentIndex: 0, content: 'hmm', partial: {} }),
      ctx,
      emit,
    );

    expect(emit).not.toHaveBeenCalled();
    expect(ctx.reasoningBuffer).toBe('');
  });

  it('emits reasoning events and buffers when showReasoning is true', () => {
    const gate = new ReasoningGate(true);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    gate.process(
      streamEvent({ type: 'thinking_start', contentIndex: 0, partial: {} }),
      ctx,
      emit,
    );
    gate.process(
      streamEvent({ type: 'thinking_delta', contentIndex: 0, delta: 'Let me think', partial: {} }),
      ctx,
      emit,
    );
    gate.process(
      streamEvent({ type: 'thinking_end', contentIndex: 0, content: 'Let me think', partial: {} }),
      ctx,
      emit,
    );

    expect(emitted).toHaveLength(3);
    expect(emitted[0]).toEqual({ type: 'reasoning:start', agentId: '', runId: 'run-1' });
    expect(emitted[1]).toEqual({ type: 'reasoning:delta', agentId: '', runId: 'run-1', delta: 'Let me think' });
    expect(emitted[2]).toEqual({ type: 'reasoning:end', agentId: '', runId: 'run-1', content: 'Let me think' });
    expect(ctx.reasoningBuffer).toBe('Let me think');
  });

  it('passes non-thinking events through unchanged', () => {
    const gate = new ReasoningGate(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    const textEvent = streamEvent({ type: 'text_delta', contentIndex: 0, delta: 'hello', partial: {} });
    gate.process(textEvent, ctx, emit);

    // Non-thinking stream events are not emitted by ReasoningGate — they pass through
    // ReasoningGate only handles thinking_* events; others are ignored (next transform handles them)
    expect(emit).not.toHaveBeenCalled();
  });

  it('passes lifecycle events through unchanged', () => {
    const gate = new ReasoningGate(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    const lifecycleEvent: CoordinatorEvent = {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    };
    gate.process(lifecycleEvent, ctx, emit);

    // Lifecycle events are not this transform's responsibility
    expect(emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/agents/stream-transforms/reasoning-gate.test.ts`
Expected: FAIL — `ReasoningGate` not found

- [ ] **Step 3: Implement ReasoningGate**

Create `server/agents/stream-transforms/reasoning-gate.ts`:

```typescript
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

export class ReasoningGate implements StreamTransform {
  constructor(private readonly showReasoning: boolean) {}

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;
    if (raw.type !== 'message_update') return;

    const aEvent = raw.assistantMessageEvent;
    if (!aEvent) return;

    switch (aEvent.type) {
      case 'thinking_start':
        if (this.showReasoning) {
          emit({ type: 'reasoning:start', agentId: '', runId: context.runId });
        }
        break;

      case 'thinking_delta':
        if (this.showReasoning) {
          context.reasoningBuffer += aEvent.delta;
          emit({ type: 'reasoning:delta', agentId: '', runId: context.runId, delta: aEvent.delta });
        }
        break;

      case 'thinking_end':
        if (this.showReasoning) {
          emit({ type: 'reasoning:end', agentId: '', runId: context.runId, content: aEvent.content });
        }
        break;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/agents/stream-transforms/reasoning-gate.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/stream-transforms/reasoning-gate.ts server/agents/stream-transforms/reasoning-gate.test.ts
git commit -m "feat: add ReasoningGate stream transform with tests"
```

---

## Task 5: ReplyFilter Transform

**Files:**
- Create: `server/agents/stream-transforms/reply-filter.ts`
- Create: `server/agents/stream-transforms/reply-filter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/agents/stream-transforms/reply-filter.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ReplyFilter } from './reply-filter';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function streamEvent(innerEvent: any): CoordinatorEvent {
  return { type: 'stream', runId: 'run-1', event: innerEvent };
}

function messageStart(): CoordinatorEvent {
  return streamEvent({ type: 'message_start', message: { role: 'assistant' } });
}

function textDelta(delta: string): CoordinatorEvent {
  return streamEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta, partial: {} },
  });
}

function textEnd(content: string): CoordinatorEvent {
  return streamEvent({
    type: 'message_update',
    assistantMessageEvent: { type: 'text_end', contentIndex: 0, content, partial: {} },
  });
}

function messageEnd(): CoordinatorEvent {
  return streamEvent({ type: 'message_end', message: { role: 'assistant' } });
}

describe('ReplyFilter', () => {
  it('forwards normal text events after text_end confirms non-NO_REPLY', () => {
    const filter = new ReplyFilter();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    filter.process(messageStart(), ctx, emit);
    filter.process(textDelta('Hello '), ctx, emit);
    filter.process(textDelta('world'), ctx, emit);
    filter.process(textEnd('Hello world'), ctx, emit);
    filter.process(messageEnd(), ctx, emit);

    // message:start, two message:delta, message:end should be emitted
    const types = emitted.map((e) => e.type);
    expect(types).toContain('message:start');
    expect(types.filter((t) => t === 'message:delta')).toHaveLength(2);
    expect(types).toContain('message:end');
    expect(ctx.textBuffer).toBe('Hello world');
    expect(ctx.noReplyDetected).toBe(false);
  });

  it('suppresses message events when text is exactly NO_REPLY', () => {
    const filter = new ReplyFilter();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    filter.process(messageStart(), ctx, emit);
    filter.process(textDelta('NO_REPLY'), ctx, emit);
    filter.process(textEnd('NO_REPLY'), ctx, emit);
    filter.process(messageEnd(), ctx, emit);

    const types = emitted.map((e) => e.type);
    expect(types).not.toContain('message:start');
    expect(types).not.toContain('message:delta');
    expect(types).not.toContain('message:end');
    expect(types).toContain('message:suppressed');
    expect(ctx.noReplyDetected).toBe(true);
    expect(ctx.messageSuppressed).toBe(true);
    // textBuffer still accumulates for late detection
    expect(ctx.textBuffer).toBe('NO_REPLY');
  });

  it('suppresses when text is no_reply (case insensitive, trimmed)', () => {
    const filter = new ReplyFilter();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    filter.process(messageStart(), ctx, emit);
    filter.process(textDelta('  no_reply  '), ctx, emit);
    filter.process(textEnd('  no_reply  '), ctx, emit);
    filter.process(messageEnd(), ctx, emit);

    expect(ctx.noReplyDetected).toBe(true);
    expect(emitted.some((e) => e.type === 'message:suppressed')).toBe(true);
  });

  it('does NOT suppress partial matches', () => {
    const filter = new ReplyFilter();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    filter.process(messageStart(), ctx, emit);
    filter.process(textDelta('NO_REPLY but more text'), ctx, emit);
    filter.process(textEnd('NO_REPLY but more text'), ctx, emit);
    filter.process(messageEnd(), ctx, emit);

    expect(ctx.noReplyDetected).toBe(false);
    expect(emitted.some((e) => e.type === 'message:start')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/agents/stream-transforms/reply-filter.test.ts`
Expected: FAIL — `ReplyFilter` not found

- [ ] **Step 3: Implement ReplyFilter**

Create `server/agents/stream-transforms/reply-filter.ts`:

```typescript
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

const NO_REPLY_PATTERN = /^no_reply$/i;

export class ReplyFilter implements StreamTransform {
  private bufferedEvents: ServerEvent[] = [];
  private pendingMessageStarted = false;

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;

    if (raw.type === 'message_start') {
      const msg = raw.message as { role?: string };
      if (msg.role === 'assistant') {
        this.pendingMessageStarted = true;
        this.bufferedEvents = [];
        this.bufferedEvents.push({
          type: 'message:start',
          agentId: '',
          runId: context.runId,
          message: { role: 'assistant' },
        } as any);
      }
      return;
    }

    if (raw.type === 'message_update') {
      const aEvent = raw.assistantMessageEvent;
      if (!aEvent) return;

      if (aEvent.type === 'text_delta') {
        context.textBuffer += aEvent.delta;
        if (this.pendingMessageStarted) {
          this.bufferedEvents.push({
            type: 'message:delta',
            agentId: '',
            runId: context.runId,
            delta: aEvent.delta,
          } as any);
        }
        return;
      }

      if (aEvent.type === 'text_end') {
        const content = (aEvent.content as string) ?? '';
        if (NO_REPLY_PATTERN.test(content.trim())) {
          // Suppress: discard buffered events
          context.noReplyDetected = true;
          context.messageSuppressed = true;
          this.bufferedEvents = [];
          this.pendingMessageStarted = false;
          emit({
            type: 'message:suppressed',
            agentId: '',
            runId: context.runId,
            reason: 'no_reply',
          } as any);
        } else {
          // Flush buffered events
          for (const buffered of this.bufferedEvents) {
            emit(buffered);
          }
          this.bufferedEvents = [];
        }
        return;
      }

      return;
    }

    if (raw.type === 'message_end') {
      if (this.pendingMessageStarted && !context.messageSuppressed) {
        const endMsg = raw.message as { role?: string; usage?: any };
        if (endMsg.role === 'assistant') {
          emit({
            type: 'message:end',
            agentId: '',
            runId: context.runId,
            message: { role: 'assistant', usage: endMsg.usage },
          } as any);
        }
      }
      this.pendingMessageStarted = false;
      return;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/agents/stream-transforms/reply-filter.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/stream-transforms/reply-filter.ts server/agents/stream-transforms/reply-filter.test.ts
git commit -m "feat: add ReplyFilter stream transform with NO_REPLY detection"
```

---

## Task 6: ToolSummaryCollector Transform

**Files:**
- Create: `server/agents/stream-transforms/tool-summary-collector.ts`
- Create: `server/agents/stream-transforms/tool-summary-collector.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/agents/stream-transforms/tool-summary-collector.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ToolSummaryCollector } from './tool-summary-collector';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function toolStartEvent(toolCallId: string, toolName: string): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: { type: 'tool_execution_start', toolCallId, toolName, args: {} },
  };
}

function toolEndEvent(
  toolCallId: string,
  toolName: string,
  resultText: string,
  isError = false,
): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: {
      type: 'tool_execution_end',
      toolCallId,
      toolName,
      result: { content: [{ type: 'text', text: resultText }] },
      isError,
    },
  };
}

describe('ToolSummaryCollector', () => {
  it('always records tool results in context', () => {
    const collector = new ToolSummaryCollector(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    collector.process(toolEndEvent('tc-1', 'search', 'found 3 results'), ctx, emit);

    expect(ctx.toolSummaries).toHaveLength(1);
    expect(ctx.toolSummaries[0]).toEqual({
      toolCallId: 'tc-1',
      toolName: 'search',
      resultText: 'found 3 results',
      isError: false,
    });
  });

  it('emits tool:start and tool:end events always', () => {
    const collector = new ToolSummaryCollector(false);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    collector.process(toolStartEvent('tc-1', 'search'), ctx, emit);
    collector.process(toolEndEvent('tc-1', 'search', 'found 3'), ctx, emit);

    expect(emitted.some((e) => e.type === 'tool:start')).toBe(true);
    expect(emitted.some((e) => e.type === 'tool:end')).toBe(true);
  });

  it('does NOT emit tool:summary when verbose is false', () => {
    const collector = new ToolSummaryCollector(false);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    collector.process(toolEndEvent('tc-1', 'search', 'found 3'), ctx, emit);

    expect(emitted.some((e) => e.type === 'tool:summary')).toBe(false);
  });

  it('emits tool:summary when verbose is true', () => {
    const collector = new ToolSummaryCollector(true);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    collector.process(toolEndEvent('tc-1', 'search', 'found 3 results'), ctx, emit);

    const summary = emitted.find((e) => e.type === 'tool:summary') as any;
    expect(summary).toBeDefined();
    expect(summary.toolName).toBe('search');
    expect(summary.summary).toBe('found 3 results');
  });

  it('truncates summary at 500 chars', () => {
    const collector = new ToolSummaryCollector(true);
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    const longResult = 'x'.repeat(1000);
    collector.process(toolEndEvent('tc-1', 'search', longResult), ctx, emit);

    const summary = emitted.find((e) => e.type === 'tool:summary') as any;
    expect(summary.summary).toHaveLength(500);
  });

  it('records isError flag on tool summaries', () => {
    const collector = new ToolSummaryCollector(false);
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    collector.process(toolEndEvent('tc-1', 'search', 'not found', true), ctx, emit);

    expect(ctx.toolSummaries[0].isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/agents/stream-transforms/tool-summary-collector.test.ts`
Expected: FAIL — `ToolSummaryCollector` not found

- [ ] **Step 3: Implement ToolSummaryCollector**

Create `server/agents/stream-transforms/tool-summary-collector.ts`:

```typescript
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

const MAX_SUMMARY_LENGTH = 500;

export class ToolSummaryCollector implements StreamTransform {
  constructor(private readonly verbose: boolean) {}

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;

    if (raw.type === 'tool_execution_start') {
      emit({
        type: 'tool:start',
        agentId: '',
        runId: context.runId,
        toolCallId: raw.toolCallId,
        toolName: raw.toolName,
      } as any);
      return;
    }

    if (raw.type === 'tool_execution_end') {
      const resultText = raw.result?.content
        ?.map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : ''))
        .join('') || '';

      // Always record in context
      context.toolSummaries.push({
        toolCallId: raw.toolCallId,
        toolName: raw.toolName,
        resultText,
        isError: !!raw.isError,
      });

      // Always emit tool:end
      emit({
        type: 'tool:end',
        agentId: '',
        runId: context.runId,
        toolCallId: raw.toolCallId,
        toolName: raw.toolName,
        result: resultText.slice(0, MAX_SUMMARY_LENGTH),
        isError: !!raw.isError,
      } as any);

      // Emit tool:summary when verbose
      if (this.verbose) {
        emit({
          type: 'tool:summary',
          agentId: '',
          runId: context.runId,
          toolCallId: raw.toolCallId,
          toolName: raw.toolName,
          summary: resultText.slice(0, MAX_SUMMARY_LENGTH),
        } as any);
      }
      return;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/agents/stream-transforms/tool-summary-collector.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/stream-transforms/tool-summary-collector.ts server/agents/stream-transforms/tool-summary-collector.test.ts
git commit -m "feat: add ToolSummaryCollector stream transform with tests"
```

---

## Task 7: CompactionHandler Transform

**Files:**
- Create: `server/agents/stream-transforms/compaction-handler.ts`
- Create: `server/agents/stream-transforms/compaction-handler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/agents/stream-transforms/compaction-handler.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CompactionHandler } from './compaction-handler';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function compactionEvent(): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: { type: 'memory_compaction', summary: 'Compacted 50 messages' },
  };
}

describe('CompactionHandler', () => {
  it('emits compaction:start and compaction:end on memory_compaction event', () => {
    const handler = new CompactionHandler();
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    handler.process(compactionEvent(), ctx, emit);

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toEqual({ type: 'compaction:start', agentId: '', runId: 'run-1' });
    expect(emitted[1]).toEqual({ type: 'compaction:end', agentId: '', runId: 'run-1', retrying: false });
  });

  it('does not reset buffers when retrying is false', () => {
    const handler = new CompactionHandler();
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'some text';
    ctx.reasoningBuffer = 'some reasoning';
    ctx.toolSummaries = [{ toolCallId: 'tc-1', toolName: 'test', resultText: 'ok', isError: false }];
    const emit = vi.fn();

    handler.process(compactionEvent(), ctx, emit);

    expect(ctx.textBuffer).toBe('some text');
    expect(ctx.reasoningBuffer).toBe('some reasoning');
    expect(ctx.toolSummaries).toHaveLength(1);
  });

  it('ignores non-compaction events', () => {
    const handler = new CompactionHandler();
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    handler.process(
      { type: 'stream', runId: 'run-1', event: { type: 'message_start', message: { role: 'assistant' } } },
      ctx,
      emit,
    );

    expect(emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/agents/stream-transforms/compaction-handler.test.ts`
Expected: FAIL — `CompactionHandler` not found

- [ ] **Step 3: Implement CompactionHandler**

Create `server/agents/stream-transforms/compaction-handler.ts`:

```typescript
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

export class CompactionHandler implements StreamTransform {
  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    if (event.type !== 'stream') return;

    const raw = event.event as any;
    if (raw.type !== 'memory_compaction') return;

    emit({ type: 'compaction:start', agentId: '', runId: context.runId } as any);

    // In this layer, retrying is always false — the compaction trigger is not built yet.
    const retrying = false;

    if (retrying) {
      context.textBuffer = '';
      context.reasoningBuffer = '';
      context.toolSummaries = [];
      context.noReplyDetected = false;
      context.messageSuppressed = false;
      context.compactionRetrying = true;
    }

    emit({ type: 'compaction:end', agentId: '', runId: context.runId, retrying } as any);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/agents/stream-transforms/compaction-handler.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/stream-transforms/compaction-handler.ts server/agents/stream-transforms/compaction-handler.test.ts
git commit -m "feat: add CompactionHandler stream transform with tests"
```

---

## Task 8: ReplyAssembler Transform

**Files:**
- Create: `server/agents/stream-transforms/reply-assembler.ts`
- Create: `server/agents/stream-transforms/reply-assembler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/agents/stream-transforms/reply-assembler.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ReplyAssembler } from './reply-assembler';
import { createRunStreamContext } from './types';
import type { CoordinatorEvent } from '../../../shared/run-types';
import type { ServerEvent } from '../../../shared/protocol';

function lifecycleEnd(): CoordinatorEvent {
  return {
    type: 'lifecycle:end',
    runId: 'run-1',
    status: 'ok',
    startedAt: 1000,
    endedAt: 2000,
    payloads: [],
    usage: undefined,
  };
}

function lifecycleError(): CoordinatorEvent {
  return {
    type: 'lifecycle:error',
    runId: 'run-1',
    status: 'error',
    error: { code: 'internal', message: 'boom', retriable: false },
    startedAt: 1000,
    endedAt: 2000,
  };
}

function messageEndEvent(usage?: any): CoordinatorEvent {
  return {
    type: 'stream',
    runId: 'run-1',
    event: { type: 'message_end', message: { role: 'assistant', usage } },
  };
}

describe('ReplyAssembler', () => {
  it('assembles text payload from textBuffer', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Hello world';
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([{ type: 'text', content: 'Hello world' }]);
  });

  it('strips NO_REPLY text payload (late detection)', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = '  NO_REPLY  ';
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads.filter((p) => p.type === 'text')).toHaveLength(0);
  });

  it('includes reasoning payload when showReasoning is true', () => {
    const assembler = new ReplyAssembler(true, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Answer';
    ctx.reasoningBuffer = 'I thought about it';
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([
      { type: 'text', content: 'Answer' },
      { type: 'reasoning', content: 'I thought about it' },
    ]);
  });

  it('omits reasoning payload when showReasoning is false', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Answer';
    ctx.reasoningBuffer = 'I thought about it';
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([{ type: 'text', content: 'Answer' }]);
  });

  it('includes tool summaries when verbose is true', () => {
    const assembler = new ReplyAssembler(false, true, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Done';
    ctx.toolSummaries = [
      { toolCallId: 'tc-1', toolName: 'search', resultText: 'found 3', isError: false },
    ];
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([
      { type: 'text', content: 'Done' },
      { type: 'tool_summary', content: 'search: found 3' },
    ]);
  });

  it('emits fallback error when no payloads and a tool errored', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'NO_REPLY';
    ctx.toolSummaries = [
      { toolCallId: 'tc-1', toolName: 'search', resultText: 'failed', isError: true },
    ];
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(ctx.payloads).toEqual([{ type: 'error', content: 'Tool execution failed' }]);
  });

  it('calls setRunPayloads with assembled payloads and usage', () => {
    const setRunPayloads = vi.fn();
    const assembler = new ReplyAssembler(false, false, setRunPayloads);
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Hello';
    ctx.usage = { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 };
    const emit = vi.fn();

    assembler.process(lifecycleEnd(), ctx, emit);

    expect(setRunPayloads).toHaveBeenCalledWith('run-1', ctx.payloads, ctx.usage);
  });

  it('emits enriched lifecycle:end with payloads and usage', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    ctx.textBuffer = 'Hello';
    ctx.usage = { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 };
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleEnd(), ctx, emit);

    const endEvent = emitted.find((e) => e.type === 'lifecycle:end') as any;
    expect(endEvent).toBeDefined();
    expect(endEvent.payloads).toEqual([{ type: 'text', content: 'Hello' }]);
    expect(endEvent.usage).toEqual(ctx.usage);
  });

  it('captures usage from message_end events', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    const emit = vi.fn();

    const usage = { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 };
    assembler.process(messageEndEvent(usage), ctx, emit);

    expect(ctx.usage).toEqual(usage);
  });

  it('passes lifecycle:error through unchanged', () => {
    const assembler = new ReplyAssembler(false, false, vi.fn());
    const ctx = createRunStreamContext('run-1');
    const emitted: ServerEvent[] = [];
    const emit = (e: ServerEvent) => emitted.push(e);

    assembler.process(lifecycleError(), ctx, emit);

    const errorEvent = emitted.find((e) => e.type === 'lifecycle:error') as any;
    expect(errorEvent).toBeDefined();
    expect(errorEvent.error.message).toBe('boom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/agents/stream-transforms/reply-assembler.test.ts`
Expected: FAIL — `ReplyAssembler` not found

- [ ] **Step 3: Implement ReplyAssembler**

Create `server/agents/stream-transforms/reply-assembler.ts`:

```typescript
import type { CoordinatorEvent, RunPayload, RunUsage } from '../../../shared/run-types';
import type { RunStreamContext, EmitFn, StreamTransform } from './types';

const NO_REPLY_PATTERN = /^no_reply$/i;

export type SetRunPayloadsFn = (runId: string, payloads: RunPayload[], usage?: RunUsage) => void;

export class ReplyAssembler implements StreamTransform {
  constructor(
    private readonly showReasoning: boolean,
    private readonly verbose: boolean,
    private readonly setRunPayloads: SetRunPayloadsFn,
  ) {}

  process(event: CoordinatorEvent, context: RunStreamContext, emit: EmitFn): void {
    // Capture usage from message_end
    if (event.type === 'stream') {
      const raw = event.event as any;
      if (raw.type === 'message_end') {
        const usage = raw.message?.usage;
        if (usage) {
          context.usage = {
            input: usage.input ?? 0,
            output: usage.output ?? 0,
            cacheRead: usage.cacheRead ?? 0,
            cacheWrite: usage.cacheWrite ?? 0,
            totalTokens: usage.totalTokens ?? 0,
          };
        }
      }
      return;
    }

    if (event.type === 'lifecycle:error') {
      emit({
        type: 'lifecycle:error',
        agentId: '',
        runId: event.runId,
        status: 'error',
        error: event.error,
        startedAt: event.startedAt,
        endedAt: event.endedAt,
      } as any);
      return;
    }

    if (event.type === 'lifecycle:end') {
      const payloads: RunPayload[] = [];

      // 1. Text payload (skip if empty or NO_REPLY)
      const text = context.textBuffer.trim();
      if (text && !NO_REPLY_PATTERN.test(text)) {
        payloads.push({ type: 'text', content: context.textBuffer });
      }

      // 2. Reasoning payload
      if (this.showReasoning && context.reasoningBuffer) {
        payloads.push({ type: 'reasoning', content: context.reasoningBuffer });
      }

      // 3. Tool summaries
      if (this.verbose) {
        for (const ts of context.toolSummaries) {
          payloads.push({ type: 'tool_summary', content: `${ts.toolName}: ${ts.resultText}` });
        }
      }

      // 4. Fallback error
      if (payloads.length === 0 && context.toolSummaries.some((ts) => ts.isError)) {
        payloads.push({ type: 'error', content: 'Tool execution failed' });
      }

      context.payloads = payloads;

      // Push to coordinator for wait() callers
      this.setRunPayloads(context.runId, payloads, context.usage);

      // Emit enriched lifecycle:end
      emit({
        type: 'lifecycle:end',
        agentId: '',
        runId: event.runId,
        status: 'ok',
        startedAt: event.startedAt,
        endedAt: event.endedAt,
        payloads,
        usage: context.usage,
      } as any);
      return;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/agents/stream-transforms/reply-assembler.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/stream-transforms/reply-assembler.ts server/agents/stream-transforms/reply-assembler.test.ts
git commit -m "feat: add ReplyAssembler stream transform with tests"
```

---

## Task 9: StreamProcessor Orchestrator

**Files:**
- Create: `server/agents/stream-processor.ts`
- Create: `server/agents/stream-processor.test.ts`

- [ ] **Step 1: Write failing integration tests**

Create `server/agents/stream-processor.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { StreamProcessor } from './stream-processor';
import type { RunCoordinator } from './run-coordinator';
import type { AgentConfig } from '../../shared/agent-config';
import type { CoordinatorEvent } from '../../shared/run-types';
import type { ServerEvent } from '../../shared/protocol';

function mockCoordinator(): RunCoordinator & { _listeners: Set<(e: CoordinatorEvent) => void> } {
  const listeners = new Set<(e: CoordinatorEvent) => void>();
  return {
    _listeners: listeners,
    subscribeAll: vi.fn((listener: (e: CoordinatorEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    setRunPayloads: vi.fn(),
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
    systemPrompt: { mode: 'manual', sections: [], assembled: 'Test', userInstructions: 'Test' },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: null,
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'agent-1',
    runTimeoutMs: 172800000,
    showReasoning: false,
    verbose: false,
    ...overrides,
  } as AgentConfig;
}

function emitToCoordinator(coordinator: ReturnType<typeof mockCoordinator>, event: CoordinatorEvent) {
  for (const listener of coordinator._listeners) {
    listener(event);
  }
}

describe('StreamProcessor', () => {
  it('processes a full run: start -> text deltas -> end -> assembled payloads', () => {
    const coordinator = mockCoordinator();
    const processor = new StreamProcessor('agent-1', coordinator as any, makeConfig());
    const emitted: ServerEvent[] = [];
    processor.subscribe((e) => emitted.push(e));

    // lifecycle:start
    emitToCoordinator(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    // message_start
    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: { type: 'message_start', message: { role: 'assistant' } },
    });

    // text_delta
    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello', partial: {} },
      },
    });

    // text_end
    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'Hello', partial: {} },
      },
    });

    // message_end with usage
    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_end',
        message: { role: 'assistant', usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 } },
      },
    });

    // lifecycle:end
    emitToCoordinator(coordinator, {
      type: 'lifecycle:end',
      runId: 'run-1',
      status: 'ok',
      startedAt: 1000,
      endedAt: 2000,
      payloads: [],
    });

    // Check emitted events include message flow and lifecycle:end with payloads
    const types = emitted.map((e) => e.type);
    expect(types).toContain('message:start');
    expect(types).toContain('message:delta');
    expect(types).toContain('message:end');
    expect(types).toContain('lifecycle:end');
    // Backwards compat
    expect(types).toContain('agent:end');

    const endEvent = emitted.find((e) => e.type === 'lifecycle:end') as any;
    expect(endEvent.payloads).toEqual([{ type: 'text', content: 'Hello' }]);
    expect(coordinator.setRunPayloads).toHaveBeenCalled();
  });

  it('suppresses NO_REPLY and emits message:suppressed', () => {
    const coordinator = mockCoordinator();
    const processor = new StreamProcessor('agent-1', coordinator as any, makeConfig());
    const emitted: ServerEvent[] = [];
    processor.subscribe((e) => emitted.push(e));

    emitToCoordinator(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: { type: 'message_start', message: { role: 'assistant' } },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'NO_REPLY', partial: {} },
      },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: 'NO_REPLY', partial: {} },
      },
    });

    const types = emitted.map((e) => e.type);
    expect(types).not.toContain('message:start');
    expect(types).not.toContain('message:delta');
    expect(types).toContain('message:suppressed');
  });

  it('forwards reasoning events when showReasoning is true', () => {
    const coordinator = mockCoordinator();
    const processor = new StreamProcessor('agent-1', coordinator as any, makeConfig({ showReasoning: true }));
    const emitted: ServerEvent[] = [];
    processor.subscribe((e) => emitted.push(e));

    emitToCoordinator(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_start', contentIndex: 0, partial: {} },
      },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm', partial: {} },
      },
    });

    emitToCoordinator(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_end', contentIndex: 0, content: 'hmm', partial: {} },
      },
    });

    const types = emitted.map((e) => e.type);
    expect(types).toContain('reasoning:start');
    expect(types).toContain('reasoning:delta');
    expect(types).toContain('reasoning:end');
  });

  it('cleans up run context on lifecycle:end', () => {
    const coordinator = mockCoordinator();
    const processor = new StreamProcessor('agent-1', coordinator as any, makeConfig());
    processor.subscribe(() => {});

    emitToCoordinator(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    // Verify context exists (internal — access via the hasRunContext helper)
    expect(processor.hasRunContext('run-1')).toBe(true);

    emitToCoordinator(coordinator, {
      type: 'lifecycle:end',
      runId: 'run-1',
      status: 'ok',
      startedAt: 1000,
      endedAt: 2000,
      payloads: [],
    });

    expect(processor.hasRunContext('run-1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/agents/stream-processor.test.ts`
Expected: FAIL — `StreamProcessor` not found

- [ ] **Step 3: Implement StreamProcessor**

Create `server/agents/stream-processor.ts`:

```typescript
import type { RunCoordinator } from './run-coordinator';
import type { AgentConfig } from '../../shared/agent-config';
import type { CoordinatorEvent } from '../../shared/run-types';
import type { ServerEvent } from '../../shared/protocol';
import { createRunStreamContext, type RunStreamContext, type EmitFn } from './stream-transforms/types';
import { ReasoningGate } from './stream-transforms/reasoning-gate';
import { ReplyFilter } from './stream-transforms/reply-filter';
import { ToolSummaryCollector } from './stream-transforms/tool-summary-collector';
import { CompactionHandler } from './stream-transforms/compaction-handler';
import { ReplyAssembler } from './stream-transforms/reply-assembler';
import type { StreamTransform } from './stream-transforms/types';

export class StreamProcessor {
  private readonly contexts = new Map<string, RunStreamContext>();
  private readonly transforms: StreamTransform[];
  private readonly listeners = new Set<(event: ServerEvent) => void>();
  private readonly unsubscribe: () => void;
  private readonly replyFilters = new Map<string, ReplyFilter>();

  constructor(
    private readonly agentId: string,
    coordinator: RunCoordinator,
    config: AgentConfig,
  ) {
    const showReasoning = config.showReasoning ?? false;
    const verbose = config.verbose ?? false;

    this.transforms = [
      new ReasoningGate(showReasoning),
      // ReplyFilter is per-run — created on lifecycle:start. Placeholder here.
      // ToolSummaryCollector and CompactionHandler are stateless across runs.
      new ToolSummaryCollector(verbose),
      new CompactionHandler(),
      new ReplyAssembler(showReasoning, verbose, (runId, payloads, usage) => {
        coordinator.setRunPayloads(runId, payloads, usage);
      }),
    ];

    this.unsubscribe = coordinator.subscribeAll((event) => {
      this.handleEvent(event);
    });
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasRunContext(runId: string): boolean {
    return this.contexts.has(runId);
  }

  destroy(): void {
    this.unsubscribe();
    this.contexts.clear();
    this.replyFilters.clear();
    this.listeners.clear();
  }

  private handleEvent(event: CoordinatorEvent): void {
    // Create context on lifecycle:start
    if (event.type === 'lifecycle:start') {
      const ctx = createRunStreamContext(event.runId);
      this.contexts.set(event.runId, ctx);
      this.replyFilters.set(event.runId, new ReplyFilter());

      // Forward lifecycle:start as-is
      this.emit({
        type: 'lifecycle:start',
        agentId: this.agentId,
        runId: event.runId,
        sessionId: event.sessionId,
        startedAt: event.startedAt,
      } as any);
      return;
    }

    // Resolve context for this run
    const runId = 'runId' in event ? event.runId : undefined;
    if (!runId) return;

    const context = this.contexts.get(runId);
    if (!context) return;

    // Build the emit chain
    const finalEmit: EmitFn = (shaped) => {
      // Stamp agentId on all outgoing events
      const stamped = { ...shaped, agentId: this.agentId } as any;
      this.emit(stamped);
    };

    // Run through transforms in order
    // Each transform calls emit for events it produces.
    // The pipeline is not a chain where one feeds the next —
    // each transform inspects the raw event and emits shaped events independently.
    const replyFilter = this.replyFilters.get(runId)!;
    const allTransforms = [this.transforms[0], replyFilter, ...this.transforms.slice(1)];

    for (const transform of allTransforms) {
      transform.process(event, context, finalEmit);
    }

    // Backwards compat emissions
    if (event.type === 'lifecycle:end') {
      this.emit({ type: 'agent:end', agentId: this.agentId });
      // Clean up
      this.contexts.delete(runId);
      this.replyFilters.delete(runId);
    } else if (event.type === 'lifecycle:error') {
      const errorEvent = event as any;
      this.emit({
        type: 'agent:error',
        agentId: this.agentId,
        error: errorEvent.error?.message ?? 'Unknown error',
      });
      // Clean up
      this.contexts.delete(runId);
      this.replyFilters.delete(runId);
    }
  }

  private emit(event: ServerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Don't break the loop
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/agents/stream-processor.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/agents/stream-processor.ts server/agents/stream-processor.test.ts
git commit -m "feat: add StreamProcessor orchestrator with integration tests"
```

---

## Task 10: Modify RunCoordinator — Remove Payload Buffering, Add setRunPayloads

**Files:**
- Modify: `server/agents/run-coordinator.ts:260-296`
- Modify: `server/agents/run-coordinator.test.ts`

- [ ] **Step 1: Add `setRunPayloads` method to RunCoordinator**

In `server/agents/run-coordinator.ts`, add after the `getLatestActiveRunId()` method:

```typescript
  setRunPayloads(runId: string, payloads: RunPayload[], usage?: RunUsage): void {
    const record = this.runs.get(runId);
    if (!record) return;
    record.payloads = payloads;
    if (usage) record.usage = usage;
  }
```

- [ ] **Step 2: Remove payload buffering from executeRun()**

In the `executeRun()` method, replace the runtime subscribe callback. Change the section that subscribes to runtime events (the `let textBuffer = ''` block through to the `});` closing the subscribe callback) to simply forward events without buffering:

```typescript
    // Subscribe to runtime events for this run — forward to stream subscribers
    const unsubscribe = this.runtime.subscribe((event: RuntimeEvent) => {
      this.emitForRun(record.runId, { type: 'stream', runId: record.runId, event });
    });
```

- [ ] **Step 3: Remove leftover textBuffer flush from the .then() and .catch() handlers**

In the `.then()` handler, remove:
```typescript
        // Flush remaining text buffer
        if (textBuffer) {
          record.payloads.push({ type: 'text', content: textBuffer });
        }
```

In the `.catch()` handler, remove:
```typescript
        if (textBuffer) {
          record.payloads.push({ type: 'text', content: textBuffer });
        }
```

- [ ] **Step 4: Update tests for new behavior**

Update `server/agents/run-coordinator.test.ts` — the tests that check `record.payloads` after a run should now expect empty payloads (since StreamProcessor handles that). Add a test for `setRunPayloads`:

Add this test to the existing describe block:

```typescript
  it('setRunPayloads updates the run record', async () => {
    const result = await coordinator.dispatch({ sessionKey: 'test-session', text: 'Hello' });
    // Wait for execution to start
    await new Promise((r) => setTimeout(r, 10));

    coordinator.setRunPayloads(result.runId, [
      { type: 'text', content: 'Hello world' },
    ], { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 });

    const record = coordinator.getRunStatus(result.runId);
    expect(record?.payloads).toEqual([{ type: 'text', content: 'Hello world' }]);
    expect(record?.usage?.totalTokens).toBe(30);
  });
```

- [ ] **Step 5: Run all coordinator tests**

Run: `npx vitest run server/agents/run-coordinator.test.ts`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts
git commit -m "refactor: move payload buffering out of RunCoordinator, add setRunPayloads"
```

---

## Task 11: Simplify EventBridge

**Files:**
- Modify: `server/agents/event-bridge.ts`
- Modify: `server/agents/event-bridge.test.ts`

- [ ] **Step 1: Rewrite EventBridge as thin broadcaster**

Replace the entire content of `server/agents/event-bridge.ts`:

```typescript
import type WebSocket from 'ws';
import type { StreamProcessor } from './stream-processor';
import type { ServerEvent } from '../../shared/protocol';

/**
 * Thin WebSocket broadcaster. Subscribes to shaped events from StreamProcessor
 * and forwards them to connected WebSocket clients.
 */
export class EventBridge {
  private sockets = new Set<WebSocket>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly agentId: string,
    processor: StreamProcessor,
  ) {
    this.unsubscribe = processor.subscribe((event) => {
      this.broadcast(event);
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

- [ ] **Step 2: Update EventBridge tests**

Replace the content of `server/agents/event-bridge.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { EventBridge } from './event-bridge';
import type { StreamProcessor } from './stream-processor';
import type { ServerEvent } from '../../shared/protocol';

function mockSocket() {
  return {
    readyState: 1,
    send: vi.fn(),
    OPEN: 1,
  } as any;
}

function mockProcessor(): StreamProcessor & { _listeners: Set<(e: ServerEvent) => void> } {
  const listeners = new Set<(e: ServerEvent) => void>();
  return {
    _listeners: listeners,
    subscribe: vi.fn((listener: (e: ServerEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as any;
}

function emitProcessorEvent(
  processor: ReturnType<typeof mockProcessor>,
  event: ServerEvent,
) {
  for (const listener of processor._listeners) {
    listener(event);
  }
}

describe('EventBridge (StreamProcessor-based)', () => {
  it('broadcasts shaped events to connected sockets', () => {
    const processor = mockProcessor();
    const bridge = new EventBridge('agent-1', processor as any);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitProcessorEvent(processor, {
      type: 'message:delta',
      agentId: 'agent-1',
      runId: 'run-1',
      delta: 'Hello',
    } as any);

    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('message:delta');
    expect(sent.delta).toBe('Hello');
  });

  it('does not send to closed sockets', () => {
    const processor = mockProcessor();
    const bridge = new EventBridge('agent-1', processor as any);
    const socket = mockSocket();
    socket.readyState = 3; // CLOSED
    bridge.addSocket(socket);

    emitProcessorEvent(processor, {
      type: 'agent:end',
      agentId: 'agent-1',
    });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('removes sockets', () => {
    const processor = mockProcessor();
    const bridge = new EventBridge('agent-1', processor as any);
    const socket = mockSocket();
    bridge.addSocket(socket);
    bridge.removeSocket(socket);

    emitProcessorEvent(processor, {
      type: 'agent:end',
      agentId: 'agent-1',
    });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('cleans up on destroy', () => {
    const processor = mockProcessor();
    const bridge = new EventBridge('agent-1', processor as any);
    bridge.addSocket(mockSocket());
    bridge.destroy();

    expect(bridge.socketCount).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run server/agents/event-bridge.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/agents/event-bridge.ts server/agents/event-bridge.test.ts
git commit -m "refactor: simplify EventBridge to thin broadcaster over StreamProcessor"
```

---

## Task 12: Wire StreamProcessor into AgentManager

**Files:**
- Modify: `server/agents/agent-manager.ts:1-70`

- [ ] **Step 1: Add StreamProcessor import and to ManagedAgent**

Add import at the top of `server/agents/agent-manager.ts`:

```typescript
import { StreamProcessor } from './stream-processor';
```

Add `processor: StreamProcessor;` to the `ManagedAgent` interface, after `coordinator`.

- [ ] **Step 2: Update `start()` to create StreamProcessor**

In the `start()` method, after `const coordinator = ...`, add:

```typescript
    const processor = new StreamProcessor(config.id, coordinator, config);
```

Change the EventBridge creation from:

```typescript
    const bridge = new EventBridge(config.id, coordinator);
```

to:

```typescript
    const bridge = new EventBridge(config.id, processor);
```

Add `processor` to the `ManagedAgent` object in `this.agents.set(...)`.

- [ ] **Step 3: Update `destroy()` to tear down StreamProcessor**

In the `destroy()` method, add `managed.processor.destroy();` after `managed.coordinator.destroy();`.

- [ ] **Step 4: Run all agent-manager tests**

Run: `npx vitest run server/agents/agent-manager.test.ts`
Expected: All tests PASS (or update mocks if needed)

- [ ] **Step 5: Verify full test suite**

Run: `npx vitest run server/`
Expected: All server tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/agents/agent-manager.ts
git commit -m "feat: wire StreamProcessor into AgentManager creation chain"
```

---

## Task 13: Agent Property Editor Toggles

**Files:**
- Modify: `src/panels/property-editors/AgentProperties.tsx`

- [ ] **Step 1: Add Show Reasoning toggle**

In `AgentProperties.tsx`, after the System Prompt section (before `{showPreview && (`), add:

```tsx
      <Field label="Show Reasoning">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.showReasoning ?? false}
            onChange={(e) => update(nodeId, { showReasoning: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-400">
            Forward model thinking/reasoning to the chat stream
          </span>
        </label>
      </Field>
```

- [ ] **Step 2: Add Verbose Tool Output toggle**

Immediately after the Show Reasoning field:

```tsx
      <Field label="Verbose Tool Output">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={data.verbose ?? false}
            onChange={(e) => update(nodeId, { verbose: e.target.checked })}
            className="rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500/30"
          />
          <span className="text-xs text-slate-400">
            Add tool result summaries to the chat stream
          </span>
        </label>
      </Field>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/panels/property-editors/AgentProperties.tsx
git commit -m "feat: add Show Reasoning and Verbose toggles to agent property editor"
```

---

## Task 14: useChatStream Hook

**Files:**
- Create: `src/chat/useChatStream.ts`

- [ ] **Step 1: Implement the hook**

Create `src/chat/useChatStream.ts`:

```typescript
import { useEffect, useRef, useCallback, useState } from 'react';
import { agentClient } from '../client';
import { useSessionStore } from '../store/session-store';
import { estimateTokens } from '../../shared/token-estimator';
import type { ServerEvent } from '../../shared/protocol';

export interface ToolSummaryInfo {
  toolCallId: string;
  toolName: string;
  summary: string;
}

export interface ChatStreamState {
  isStreaming: boolean;
  reasoning: string | null;
  isReasoning: boolean;
  suppressedReply: boolean;
  compacting: boolean;
  toolSummaries: ToolSummaryInfo[];
  sendMessage: (text: string, sessionId: string, attachments?: any[]) => void;
}

export function useChatStream(agentNodeId: string): ChatStreamState {
  const [isStreaming, setIsStreaming] = useState(false);
  const [reasoning, setReasoning] = useState<string | null>(null);
  const [isReasoning, setIsReasoning] = useState(false);
  const [suppressedReply, setSuppressedReply] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [toolSummaries, setToolSummaries] = useState<ToolSummaryInfo[]>([]);

  const addMessage = useSessionStore((s) => s.addMessage);
  const updateMessage = useSessionStore((s) => s.updateMessage);
  const deleteMessage = useSessionStore((s) => s.deleteMessage);

  const unsubRef = useRef<(() => void) | null>(null);
  const assistantMsgIdRef = useRef<string>('');
  const assistantContentRef = useRef<string>('');
  const sessionIdRef = useRef<string>('');

  const cleanup = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
  }, []);

  // Clean up on unmount
  useEffect(() => cleanup, [cleanup]);

  const sendMessage = useCallback(
    (text: string, sessionId: string, attachments?: any[]) => {
      cleanup();

      const msgId = `msg_${Date.now()}_a`;
      assistantMsgIdRef.current = msgId;
      assistantContentRef.current = '';
      sessionIdRef.current = sessionId;

      setIsStreaming(true);
      setSuppressedReply(false);
      setToolSummaries([]);
      setReasoning(null);
      setIsReasoning(false);

      const unsub = agentClient.onEvent((event: ServerEvent) => {
        if (!('agentId' in event) || (event as any).agentId !== agentNodeId) return;

        switch (event.type) {
          case 'message:start':
            assistantContentRef.current = '';
            setReasoning(null);
            setIsReasoning(false);
            addMessage(sessionIdRef.current, {
              id: assistantMsgIdRef.current,
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
            });
            break;

          case 'message:delta':
            assistantContentRef.current += event.delta;
            updateMessage(sessionIdRef.current, assistantMsgIdRef.current, (m) => ({
              ...m,
              content: assistantContentRef.current,
            }));
            break;

          case 'message:end':
            if (event.message.usage) {
              updateMessage(sessionIdRef.current, assistantMsgIdRef.current, (m) => ({
                ...m,
                tokenCount: event.message.usage!.output,
                usage: event.message.usage,
              }));
            }
            break;

          case 'reasoning:start':
            setIsReasoning(true);
            setReasoning('');
            break;

          case 'reasoning:delta':
            setReasoning((prev) => (prev ?? '') + (event as any).delta);
            break;

          case 'reasoning:end':
            setIsReasoning(false);
            break;

          case 'message:suppressed':
            setSuppressedReply(true);
            // Remove partial assistant message if one was started
            if (assistantMsgIdRef.current) {
              deleteMessage(sessionIdRef.current, assistantMsgIdRef.current);
            }
            break;

          case 'tool:start':
            addMessage(sessionIdRef.current, {
              id: `tool_${(event as any).toolCallId}`,
              role: 'tool',
              content: `Calling tool: ${(event as any).toolName}`,
              timestamp: Date.now(),
            });
            break;

          case 'tool:end': {
            const te = event as any;
            const toolContent = `${te.toolName}: ${te.result}${te.isError ? ' (error)' : ''}`;
            updateMessage(sessionIdRef.current, `tool_${te.toolCallId}`, (m) => ({
              ...m,
              content: toolContent,
              tokenCount: estimateTokens(toolContent),
            }));
            break;
          }

          case 'tool:summary':
            setToolSummaries((prev) => [
              ...prev,
              {
                toolCallId: (event as any).toolCallId,
                toolName: (event as any).toolName,
                summary: (event as any).summary,
              },
            ]);
            break;

          case 'compaction:start':
            setCompacting(true);
            break;

          case 'compaction:end':
            setCompacting(false);
            break;

          case 'agent:end':
          case 'lifecycle:end':
            setIsStreaming(false);
            setIsReasoning(false);
            setCompacting(false);
            unsub();
            break;

          case 'agent:error':
          case 'lifecycle:error': {
            const errorMsg = (event as any).error?.message ?? (event as any).error ?? 'Unknown error';
            addMessage(sessionIdRef.current, {
              id: `err_${Date.now()}`,
              role: 'assistant',
              content: `Error: ${errorMsg}`,
              timestamp: Date.now(),
            });
            setIsStreaming(false);
            setIsReasoning(false);
            setCompacting(false);
            unsub();
            break;
          }
        }
      });

      unsubRef.current = unsub;

      // Send the prompt
      agentClient.send({
        type: 'agent:prompt',
        agentId: agentNodeId,
        sessionId: sessionId,
        text,
        attachments,
      });
    },
    [agentNodeId, addMessage, updateMessage, deleteMessage, cleanup],
  );

  return {
    isStreaming,
    reasoning,
    isReasoning,
    suppressedReply,
    compacting,
    toolSummaries,
    sendMessage,
  };
}
```

- [ ] **Step 2: Add `deleteMessage` to session store if missing**

Check if `useSessionStore` has a `deleteMessage` method. If not, add it to `src/store/session-store.ts`:

```typescript
  deleteMessage: (sessionId: string, messageId: string) => void;
```

Implementation:

```typescript
  deleteMessage: (sessionId, messageId) => {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...session,
            messages: session.messages.filter((m) => m.id !== messageId),
          },
        },
      };
    });
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/chat/useChatStream.ts src/store/session-store.ts
git commit -m "feat: add useChatStream hook for frontend stream adaptation"
```

---

## Task 15: Refactor ChatDrawer to Use useChatStream

**Files:**
- Modify: `src/chat/ChatDrawer.tsx:265-330`

- [ ] **Step 1: Import useChatStream**

Add at the top of `ChatDrawer.tsx`:

```typescript
import { useChatStream } from './useChatStream';
```

- [ ] **Step 2: Replace inline event subscription**

In the `ChatDrawer` component, replace the `isStreaming` state, the `unsubRef`, the `assistantMessageId` / `assistantContent` variables, and the entire `handleSend` event subscription block with a call to `useChatStream`.

Before the existing `handleSend` callback, add:

```typescript
  const chatStream = useChatStream(agentNodeId);
```

Remove:
- `const [isStreaming, setIsStreaming] = useState(false);`
- `const unsubRef = useRef<(() => void) | null>(null);`

Replace the `handleSend` callback body. Remove the `agentClient.onEvent` subscription and replace with:

```typescript
  const handleSend = useCallback(() => {
    const trimmedInput = input.trim();
    if (!trimmedInput || chatStream.isStreaming) return;
    if (!config) return;

    // Ensure agent is started
    startAgent(agentNodeId, config);

    const currentAttachments = [...attachments];

    // Add user message to session
    addMessage(activeSessionId, {
      id: `msg_${Date.now()}_u`,
      role: 'user',
      content: trimmedInput,
      timestamp: Date.now(),
      tokenCount: estimateTokens(trimmedInput),
    });

    setInput('');
    setAttachments([]);

    chatStream.sendMessage(trimmedInput, activeSessionId, currentAttachments.length ? currentAttachments : undefined);
  }, [input, attachments, chatStream, config, agentNodeId, activeSessionId, startAgent, addMessage]);
```

- [ ] **Step 3: Update references to isStreaming**

Replace all `isStreaming` references with `chatStream.isStreaming` throughout the component.

- [ ] **Step 4: Update handleStop**

```typescript
  const handleStop = () => {
    abortAgent(agentNodeId);
  };
```

(Remove `setIsStreaming(false)` — the hook handles state reset via lifecycle events.)

- [ ] **Step 5: Add minimal reasoning/compaction UI indicators**

After the message list, add conditional indicators:

```tsx
{chatStream.isReasoning && (
  <div className="px-4 py-1 text-xs text-slate-500 italic">
    Thinking...
  </div>
)}
{chatStream.compacting && (
  <div className="px-4 py-1 text-xs text-amber-500 italic">
    Compacting context...
  </div>
)}
```

- [ ] **Step 6: Verify TypeScript compiles and the app builds**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/chat/ChatDrawer.tsx
git commit -m "refactor: replace ChatDrawer inline subscription with useChatStream hook"
```

---

## Task 16: Full Integration Verification

**Files:** (no new files — verification only)

- [ ] **Step 1: Run all server tests**

Run: `npx vitest run server/`
Expected: All tests PASS

- [ ] **Step 2: Run all frontend tests**

Run: `npx vitest run src/`
Expected: All tests PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds

- [ ] **Step 6: Final commit if any fixes were needed**

If any fixes were made during verification:

```bash
git add -A
git commit -m "fix: address integration issues from streaming & reply shaping"
```
