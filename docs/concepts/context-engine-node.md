# Context Engine Node

> Manages token budgets, message compaction, and RAG integration to keep conversations within the model's context window.

<!-- source: src/types/nodes.ts#ContextEngineNodeData -->
<!-- last-verified: 2026-04-03 -->

## Overview

The Context Engine Node controls how an agent manages its conversation context. As conversations grow, they can exceed the model's context window. The Context Engine applies compaction strategies to trim or summarize older messages, tracks token usage against a budget, and optionally integrates RAG (Retrieval-Augmented Generation) for pulling in relevant external context.

It implements an OpenClaw-inspired lifecycle: **assemble** (gather messages within budget) → **compact** (reduce if over budget) → **afterTurn** (post-turn bookkeeping). This lifecycle is wired into `pi-agent-core`'s `transformContext` hook, which runs before each LLM call.

The Context Engine also supports system prompt additions — extra instructions appended to the agent's system prompt at runtime.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Context Engine"` | Display label on the canvas |
| `tokenBudget` | `number` | `128000` | Maximum tokens for the full context |
| `reservedForResponse` | `number` | `4096` | Tokens reserved for the model's response |
| `ownsCompaction` | `boolean` | `false` | Whether this node owns compaction (vs. memory node) |
| `compactionStrategy` | `CompactionStrategy` | `"sliding-window"` | Strategy: `summary`, `sliding-window`, `trim-oldest`, `hybrid` |
| `compactionTrigger` | `string` | `"auto"` | When to compact: `auto`, `manual`, `threshold` |
| `compactionThreshold` | `number` | `0.8` | Usage ratio that triggers compaction (0-1) |
| `systemPromptAdditions` | `string[]` | `[]` | Extra text appended to the system prompt |
| `autoFlushBeforeCompact` | `boolean` | `true` | Flush pending operations before compacting |
| `ragEnabled` | `boolean` | `false` | Enable RAG retrieval |
| `ragTopK` | `number` | `5` | Number of RAG results to retrieve |
| `ragMinScore` | `number` | `0.7` | Minimum similarity score for RAG results |

## Runtime Behavior

At runtime, the configuration creates a `ContextEngine` instance (`src/runtime/context-engine.ts`) which exposes:

**`buildTransformContext()`** — Returns a function that plugs into `pi-agent-core`'s `transformContext` option. Before each LLM call, this function runs `assemble()` on the current messages, compacting if the estimated token count exceeds `tokenBudget - reservedForResponse`.

**`assemble(messages)`** — Estimates token usage. If over budget, calls `compact()`. Returns the processed messages, estimated token count, and any system prompt additions.

**`compact(messages)`** — Applies the configured compaction strategy:
- `trim-oldest`: Drops oldest messages one by one until within budget (keeps minimum 2)
- `sliding-window`: Same behavior as trim-oldest (drops from the front)
- `summary` / `hybrid`: Keeps the most recent 30% of messages, summarizes older ones into a single user message with truncated content (max 2000 chars)

**`afterTurn(messages)`** — Post-turn hook for future bookkeeping (currently a no-op placeholder).

**`getSystemPromptAddition()`** — Joins all `systemPromptAdditions` with double newlines. This is appended to the agent's system prompt during `AgentRuntime` construction.

Token estimation uses a character-based heuristic in `src/runtime/token-estimator.ts`.

## Connections

- **Sends to**: Agent Node
- **Receives from**: None
- At most one Context Engine Node should be connected to an agent.

## Example

```json
{
  "type": "contextEngine",
  "label": "Context Engine",
  "tokenBudget": 128000,
  "reservedForResponse": 4096,
  "ownsCompaction": true,
  "compactionStrategy": "hybrid",
  "compactionTrigger": "auto",
  "compactionThreshold": 0.8,
  "systemPromptAdditions": ["Always cite your sources."],
  "autoFlushBeforeCompact": true,
  "ragEnabled": false,
  "ragTopK": 5,
  "ragMinScore": 0.7
}
```
