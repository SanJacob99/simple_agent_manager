# Context Engine Node

> Manages token budgets, compaction, and transcript-aware context assembly so conversations stay inside the model's context window.

<!-- source: src/types/nodes.ts#ContextEngineNodeData -->
<!-- last-verified: 2026-07-27 -->
<!-- token-budget-inheritance, compaction-trigger-modes, tooltips -->

## Overview

The Context Engine Node controls how an agent assembles prompt context, when it compacts older conversation state, and whether RAG content is allowed into that budget. It plugs into `pi-agent-core` through `transformContext`, so the agent can trim or summarize history before each model call.

In the current implementation, compaction is no longer only an in-memory concern. When the runtime binds an active session transcript, summary-style compaction writes a real `compaction` entry into the session file through `SessionManager`. That allows resumed sessions to rebuild context from persisted compaction summaries instead of depending on a still-live process.

> **Status:** `summaryModelId`, `autoFlushBeforeCompact`, and the RAG fields (`ragEnabled`, `ragTopK`, `ragMinScore`) are schema-only today — `server/runtime/context-engine.ts` never reads any of them. Token budgeting and compaction (`summary`/`sliding-window`/`trim-oldest`) are fully wired; model-driven summarization, buffer flushing, and RAG retrieval are not.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Context Engine"` | Display label on the canvas |
| `tokenBudget` | `number` | `128000` | Max tokens for assembled context |
| `reservedForResponse` | `number` | `4096` | Tokens reserved for the model response |
| `compactionStrategy` | `CompactionStrategy` | `"summary"` | `summary`, `sliding-window`, or `trim-oldest` |
| `summaryModelId` | `string` | `""` | Model id intended to select which model produces summaries (only for `summary`). **Not read by the runtime today** — the `summary` strategy in `server/runtime/context-engine.ts` always builds summaries via plain string truncation, never a model call |
| `compactionTrigger` | `string` | `"auto"` | When proactive compaction fires from `afterTurn`. `auto` → at 80% of the post-reservation budget; `threshold` → at `compactionThreshold` (ratio) of the budget; `manual` → never auto-fires (only via the Compact Now button). `assemble()`'s overflow check stays on as a safety net for all modes. |
| `compactionThreshold` | `number` | `0.8` | In `threshold` mode, the 0–1 ratio of the post-reservation budget at which compaction fires. In `manual` mode, an absolute token count surfaced in the panel preview. Ignored in `auto` mode. |
| `postCompactionTokenTarget` | `number` | `50000` | Token ceiling the assembled context should land at after compaction runs. Clamped to `Math.max(512, Math.min(postCompactionTokenTarget, tokenBudget - reservedForResponse))` — floored at 512 tokens. |
| `autoFlushBeforeCompact` | `boolean` | `true` | Intended to flush pending buffers before compaction. **Not read by the runtime today** — no flush logic exists in `server/runtime/context-engine.ts` |
| `ragEnabled` | `boolean` | `false` | Schema field for enabling RAG retrieval. **Not implemented in the runtime today** — `server/runtime/context-engine.ts` never reads `ragEnabled`/`ragTopK`/`ragMinScore`; no retrieval happens regardless of this value |
| `ragTopK` | `number` | `5` | Schema-only; see `ragEnabled`. Not read by the runtime |
| `ragMinScore` | `number` | `0.7` | Schema-only; see `ragEnabled`. Not read by the runtime |

## Runtime Behavior

The runtime creates a `ContextEngine` that exposes:

- `buildTransformContext()` to plug into `pi-agent-core`
- `assemble(messages)` to estimate tokens and call compaction when the budget would overflow (safety net)
- `compact(messages)` to apply the configured reduction strategy
- `afterTurn(messages)` to fire proactive compaction when the just-finished turn pushed usage past the trigger configured by `compactionTrigger` (see the table above). `afterTurn` applies the compacted result back onto the live message array in place, so proactive/`auto`/`threshold` compaction genuinely reduces the in-memory history rather than recomputing and discarding it (which previously left history unchanged and re-fired every turn once over threshold). The `assemble()` overflow trim remains the safety net.

Manual compaction: the Context Engine property panel shows a **Compact Now** button when `compactionTrigger` is `"manual"`. It calls `POST /api/sessions/:agentId/:sessionKey/compact`, which runs the configured `compactionStrategy` against the session transcript until it reaches `postCompactionTokenTarget`. The agent must be started (the chat session must have been opened at least once), and no run can be active on the target session.

Current compaction behavior:

- `trim-oldest` and `sliding-window` keep the newest messages that fit
- `summary` keeps the newest slice of conversation and replaces older context with a generated summary message
- when a live transcript is bound, summary compaction appends a persisted `compaction` entry via `SessionManager.appendCompaction(...)`
- the runtime emits a `memory_compaction` event when one of these persisted summaries is written, so the UI can show compacting state

The context engine no longer owns system prompt additions. Prompt construction is handled by the agent runtime's assembled system prompt.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- One Context Engine per agent

## Example

```json
{
  "type": "contextEngine",
  "label": "Context Engine",
  "tokenBudget": 128000,
  "reservedForResponse": 4096,
  "compactionStrategy": "summary",
  "summaryModelId": "",
  "compactionTrigger": "auto",
  "compactionThreshold": 0.8,
  "postCompactionTokenTarget": 50000,
  "autoFlushBeforeCompact": true,
  "ragEnabled": false,
  "ragTopK": 5,
  "ragMinScore": 0.7
}
```
