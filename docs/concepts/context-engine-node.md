# Context Engine Node

> Manages token budgets, compaction, and transcript-aware context assembly so conversations stay inside the model's context window.

<!-- source: src/types/nodes.ts#ContextEngineNodeData -->
<!-- last-verified: 2026-07-05 -->
<!-- token-budget-inheritance, compaction-trigger-modes, tooltips -->

## Overview

The Context Engine Node controls how an agent assembles prompt context and when it compacts older conversation state. It plugs into `pi-agent-core` through `transformContext`, so the agent can trim or summarize history before each model call. It also carries a `ragEnabled`/`ragTopK`/`ragMinScore` config surface intended to gate RAG content into that budget, but — see the caveat under Configuration — the runtime `ContextEngine` class does not read these fields yet.

In the current implementation, compaction is no longer only an in-memory concern. When the runtime binds an active session transcript, summary-style compaction writes a real `compaction` entry into the session file through `SessionManager`. That allows resumed sessions to rebuild context from persisted compaction summaries instead of depending on a still-live process.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Context Engine"` | Display label on the canvas |
| `tokenBudget` | `number` | `128000` | Max tokens for assembled context |
| `reservedForResponse` | `number` | `4096` | Tokens reserved for the model response |
| `compactionStrategy` | `CompactionStrategy` | `"summary"` | `summary`, `sliding-window`, or `trim-oldest` |
| `summaryModelId` | `string` | `""` | Model id used to produce summaries (only for `summary`). Empty means inherit the agent's model |
| `compactionTrigger` | `string` | `"auto"` | When proactive compaction fires from `afterTurn`. `auto` → at 80% of the post-reservation budget; `threshold` → at `compactionThreshold` (ratio) of the budget; `manual` → never auto-fires (only via the Compact Now button). `assemble()`'s overflow check stays on as a safety net for all modes. |
| `compactionThreshold` | `number` | `0.8` | In `threshold` mode, the 0–1 ratio of the post-reservation budget at which compaction fires. In `manual` mode, an absolute token count surfaced in the panel preview. Ignored in `auto` mode. |
| `postCompactionTokenTarget` | `number` | `50000` | Token ceiling the assembled context should land at after compaction runs. Clamped to `tokenBudget - reservedForResponse`. |
| `autoFlushBeforeCompact` | `boolean` | `true` | Flush pending buffers before compaction |
| `ragEnabled` | `boolean` | `false` | Intended to enable RAG retrieval — **not yet read by `server/runtime/context-engine.ts`**; currently inert config |
| `ragTopK` | `number` | `5` | Intended number of RAG results to retrieve — **not yet wired into the runtime** |
| `ragMinScore` | `number` | `0.7` | Intended minimum similarity threshold for RAG results — **not yet wired into the runtime** |

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

The `ragEnabled`/`ragTopK`/`ragMinScore` fields are typed and resolved through `resolveAgentConfig()` and `shared/agent-config.ts` like every other field on this node, but `server/runtime/context-engine.ts` never reads them — there is no RAG retrieval step wired into this node's runtime today. Treat them as a schema-only surface (see `CLAUDE.md`'s note on schema-ahead-of-wiring fields) until an engine change consumes them. Vector-backed retrieval that does work end-to-end today comes from a connected [Vector Database node](vector-database-node.md), which auto-attaches its own tool set independent of this node.

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
