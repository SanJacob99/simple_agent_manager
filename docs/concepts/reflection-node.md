# Reflection Node

> Wraps the finalize step in a draft → critique → revise loop: a critic scores the agent's candidate reply against a rubric and, below a threshold, feeds the critique back for up to N revisions.

<!-- source: src/types/nodes.ts#ReflectionNodeData -->
<!-- last-verified: 2026-07-01 -->

## Overview

The Reflection node adds a self-critique pass to an agent. After the agent produces a candidate reply, a critic scores it (0..1) against the node's `rubric`. If the score meets `scoreThreshold` the reply is accepted as-is; otherwise the critique is fed back and the agent revises, repeating until the threshold is met or `maxRevisions` is exhausted. This is the Reflexion-style "draft → critique → revise" loop, which measurably lifts answer quality on hard tasks.

Reflection wraps the same finalize step as the Structured Output and Guardrails nodes, so quality enforcement, schema enforcement, and content safety compose in one place. At most one Reflection node binds to an agent (the first connected node wins), mirroring the single-binding shape of Structured Output.

It pairs naturally with the Evals node: the same rubric that grades an eval suite can drive the critic here, and a cheaper `criticModelId` keeps the extra passes affordable.

> **Status:** the node, resolved config, and engine are scaffolded and unit-tested. Wiring `runReflection` into `server/agents/run-coordinator.ts`'s finalize step (run it after the streamed reply, before Structured Output / Guardrails, replace the reply with `result.finalReply`, and emit a `reflection:below_threshold` event when `selection` is `warn`), together with real model-backed critic/revise functions, is the remaining integration step. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Reflection"` | Human-readable label shown on the node and in reflection events. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the node is wired but the finalize step is unchanged. |
| `rubric` | `string` | correctness/completeness prompt | Criteria the critic scores the reply against. Empty falls back to a general quality rubric. |
| `maxRevisions` | `number` | `1` | Revise passes after the initial draft. `0` makes the loop critique-only (no rewrite). |
| `scoreThreshold` | `number` | `0.7` | Accept once an attempt's score (0..1) reaches this. `1` forces every allowed revision. |
| `criticModelId` | `string` | `""` | Model used for the critique / revise passes. Empty falls back to the agent's model. |
| `onMaxRevisions` | `'accept_best' \| 'accept_last' \| 'warn'` | `'accept_best'` | What to return when revisions are exhausted without meeting the threshold. |
| `includeCritiqueInTranscript` | `boolean` | `false` | When `true`, critique text is kept in the transcript instead of being dropped. |

Properties are derived from `src/types/nodes.ts#ReflectionNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves the first connected Reflection node into a single `ResolvedReflectionConfig` on `AgentConfig.reflection` (`shared/agent-config.ts`), or `null` when none is connected. The field is optional so existing `AgentConfig` fixtures remain compatible.

`server/runtime/reflection-engine.ts` provides the dependency-free orchestration substrate:

- **`runReflection(config, candidate, { critic, revise })`** — drives the loop. It critiques the current reply; if the score meets `scoreThreshold` it accepts, otherwise (while revisions remain) it revises and repeats. It returns a `ReflectionResult` — `{ finalReply, accepted, revisions, bestScore, attempts, selection }`. The `critic` and `revise` passes are injected, so the loop is fully testable without a model client; the runtime supplies real model-backed implementations.
- **`buildCritiquePrompt(reply, rubric)` / `buildRevisePrompt(reply, critique, rubric)`** — produce the prompt text for the two passes.
- **`parseCritique(text)`** — reads a `{ score, critique }` outcome from a judge reply, tolerating a `SCORE: 0.8` header or a bare leading number and normalizing 0..10 / 0..100 scales.

When the threshold is never met, `onMaxRevisions` selects the returned reply: `accept_best` returns the highest-scoring attempt, `accept_last` returns the final revision, and `warn` returns the best attempt but reports `selection: 'warn'` so the runtime can surface a below-threshold signal.

## Connections

Peripheral → Agent. At most one Reflection node binds to a single Agent; the first connected node wins.

## Example

```json
{
  "type": "reflection",
  "label": "Self-review",
  "enabled": true,
  "rubric": "Is the answer correct, complete, and free of unsupported claims?",
  "maxRevisions": 2,
  "scoreThreshold": 0.8,
  "criticModelId": "anthropic/claude-haiku-4-5-20251001",
  "onMaxRevisions": "accept_best",
  "includeCritiqueInTranscript": false
}
```
