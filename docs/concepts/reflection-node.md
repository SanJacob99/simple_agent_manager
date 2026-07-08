# Reflection Node

> Wraps the agent's finalize step in a Reflexion-style "draft → critique → revise" loop: a critic scores each draft against a rubric and feeds the critique back for revision until the score crosses a threshold or the revision budget is spent.

<!-- source: src/types/nodes.ts#ReflectionNodeData -->
<!-- last-verified: 2026-07-08 -->

## Overview

The Reflection node raises answer quality on hard tasks by having the agent review and improve its own work before replying. After the agent produces a candidate, a critic pass scores it against a `rubric`; if the score is below `scoreThreshold`, the critique is fed back and the agent revises, for up to `maxRevisions` rounds. This mirrors Reflexion / Self-Refine and the critique chains in LangGraph, DSPy, and CrewAI.

At most one Reflection node binds to an agent — it wraps the single finalize step — so it resolves to a single optional value on `AgentConfig.reflection` rather than a list (like Structured Output). It pairs naturally with the [Evals node](evals-node.md): the same rubric that grades a suite can drive the in-run critique.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring the loop into `server/agents/run-coordinator.ts`'s finalize step (run the critique/revise rounds around `runtime.prompt()`, resolve `criticModelId` through the model resolver, emit `reflection:revised` / `reflection:below_threshold` events) is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Reflection"` | Human-readable label shown on the node. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but the reply is finalized without a critique/revise pass. |
| `rubric` | `string` | "correct, complete, … clearly written" | The criteria the critic scores each draft against, in plain language. |
| `scoreThreshold` | `number` | `0.8` | Minimum critic score (0–1) a draft must reach to be accepted without further revision. |
| `maxRevisions` | `number` | `1` | Revise rounds after the initial draft. `0` critiques once but never revises. |
| `criticModelId` | `string` | `""` | Model used for the critique pass. Empty falls back to the agent's own model; a cheaper model often suffices. |
| `critiquePrompt` | `string` | `""` | Extra guidance appended to the critic's scoring instruction. |
| `onExhaustion` | `'use_best' \| 'use_last' \| 'warn'` | `'use_best'` | What to finalize when revisions run out without crossing the threshold. |
| `injectRubricIntoPrompt` | `boolean` | `false` | Append the rubric to the agent's system prompt so the first draft already targets the quality bar. |

Properties are derived from `src/types/nodes.ts#ReflectionNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected Reflection node into a `ResolvedReflectionConfig` on `AgentConfig.reflection` (`shared/agent-config.ts`). Agents without one have `reflection === null` and the runtime finalizes the reply directly.

`server/runtime/reflection-engine.ts` provides the loop substrate (dependency-free; it reuses `extractJson` from the structured-output engine):

- **`buildRubricPromptSection(config)`** — system-prompt injection used when `injectRubricIntoPrompt` is set, priming the first draft.
- **`buildCritiquePrompt(config, userTask, candidate)`** — the prompt handed to the critic model, asking for a JSON `{ score, feedback }` verdict.
- **`parseCritique(text, threshold)`** — recovers a `Critique` from the critic's reply (JSON, fenced JSON, prose `score:` line); returns `null` when no score can be recovered, which the runtime treats as "cannot critique" and passes the draft through.
- **`normalizeScore(raw)`** — clamps a raw score into 0–1, rescaling 0–10 / 0–100 answers.
- **`shouldRevise(config, critique, attempt)`** — the revise decision: false once the critique passes, the budget is spent, or reflection is disabled.
- **`buildRevisionPrompt(config, candidate, critique)`** — the re-prompt that carries the critic's feedback into the next draft.
- **`selectFinal(config, attempts)`** — applies the exhaustion policy and returns the reply to finalize plus whether the threshold was met. A passing attempt always wins; otherwise `use_best` picks the highest score, `use_last` / `warn` pick the final revision.

## Connections

Peripheral → Agent. At most one Reflection node binds to a single Agent; the first connected node wins if more than one is wired.

## Example

```json
{
  "type": "reflection",
  "label": "Answer critic",
  "enabled": true,
  "rubric": "The answer is factually correct, cites concrete evidence, and directly resolves the user's question without hedging.",
  "scoreThreshold": 0.85,
  "maxRevisions": 2,
  "criticModelId": "anthropic/claude-haiku-4-5",
  "critiquePrompt": "Weight factual accuracy above style. Penalize unsupported claims heavily.",
  "onExhaustion": "use_best",
  "injectRubricIntoPrompt": true
}
```
