# Evals Node

> Attaches a dataset of input → expected cases to an agent and scores its replies with deterministic graders or an LLM judge, for eval-driven development and regression gating.

<!-- source: src/types/nodes.ts#EvalsNodeData -->
<!-- last-verified: 2026-07-21 -->

## Overview

The Evals node turns an agent into something you can measure. It holds a suite of cases — each an `input` prompt paired with an `expected` reference — plus a grader that decides whether a reply is correct. Eval-driven agent development is now table stakes: this brings the builder in line with OpenAI Evals, Braintrust, Promptfoo, and LangSmith datasets.

A suite is designed to run offline, replaying each case through the resolved agent headlessly, scoring the reply, and producing a weighted suite score with a pass/fail verdict — not on the live chat path. Today `EvalRunner` (`server/evals/eval-runner.ts`) is only exercised via its unit tests; see Status below for the still-missing `sam eval` subcommand and Settings panel. Five graders are supported: `exact_match`, `contains`, `regex`, `json_schema` (the reply must satisfy a JSON Schema — reusing the same dependency-free validator as the Structured Output node), and `llm_judge` (a judge model scores the reply against a rubric).

You can attach more than one Evals node to a single agent — for example a fast smoke suite plus a fuller regression suite. Each resolves to its own entry and is executed independently. With `failOnRegression` set, the runner compares a suite's score against the previously recorded best and flags a regression if it drops, enabling eval gating in CI.

> **Status:** the node, resolved config, and runner are scaffolded and unit-tested. Wiring `EvalRunner` into `server/agents/run-coordinator.ts` (replay each case as a headless ephemeral run, supply a real `JudgeFn`) and exposing a `sam eval` subcommand plus a Settings panel are the remaining integration steps. Treat this as an extension surface until that path is verified end-to-end.

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Evals"` | Human-readable label shown on the node and in suite reports. |
| `enabled` | `boolean` | `true` | Master toggle. When `false` the suite is wired but never executed. |
| `cases` | `EvalCase[]` | one smoke case | The dataset of input → expected cases. |
| `defaultGrader` | `EvalGraderType` | `'contains'` | Grader used for cases that don't set their own. |
| `passThreshold` | `number` | `0.8` | Weighted suite score (0–1) at or above which the suite passes. |
| `judgeModelId` | `string` | `""` | Model used for `llm_judge` cases. Empty falls back to the agent's model. |
| `judgePrompt` | `string` | rubric text | Instructions appended to the judge prompt for `llm_judge` cases. |
| `maxConcurrency` | `number` | `4` | How many cases the runner executes in parallel. |
| `failOnRegression` | `boolean` | `false` | Flag the run when its score drops below the previously recorded best. |

Each `EvalCase` is `{ id, input, expected, grader?, weight }`. `expected` is interpreted by the case's grader: expected text (`exact_match`/`contains`), a regex source (`regex`), a JSON Schema string (`json_schema`), or judge reference (`llm_judge`). A case without a `grader` inherits `defaultGrader`.

Properties are derived from `src/types/nodes.ts#EvalsNodeData` and defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`src/utils/graph-to-agent.ts` resolves each connected Evals node into a `ResolvedEvalsConfig` entry on `AgentConfig.evals` (`shared/agent-config.ts`), folding each case's grader down to a concrete value (`grader ?? defaultGrader`). The list is optional — agents without an Evals node have `evals === undefined`.

`server/evals/eval-runner.ts` provides the scoring substrate:

- **`gradeDeterministic(grader, expected, actual)`** — scores a reply for every grader except `llm_judge` (which returns `null`, signalling an async judge is required). `json_schema` reuses `parseSchema` / `extractJson` / `validateAgainstSchema` from the structured-output engine.
- **`scoreSuite(results, passThreshold)`** — aggregates per-case results into a weighted mean score, an unweighted pass rate, and a pass verdict.
- **`EvalRunner.run(previousBest?)`** — replays every case through an injected `CaseExecutor`, grading each reply (using an injected `JudgeFn` for `llm_judge` cases), bounded by `maxConcurrency`, and returns an `EvalReport`. When `failOnRegression` is set and a `previousBest` is supplied, the report carries `regressed`/`previousBest`.

Model execution and the judge are **injected**, not imported, so the runner stays free of runtime/React/network dependencies and is unit-testable without touching a model.

## Connections

Peripheral → Agent. Multiple Evals nodes may connect to a single Agent; each suite is scored independently.

## Example

```json
{
  "type": "evals",
  "label": "Regression suite",
  "enabled": true,
  "defaultGrader": "contains",
  "passThreshold": 0.9,
  "judgeModelId": "anthropic/claude-opus-4-8",
  "judgePrompt": "Score how well the reply satisfies the expected answer, 0 to 1.",
  "maxConcurrency": 4,
  "failOnRegression": true,
  "cases": [
    { "id": "greet", "input": "Say hi", "expected": "hi", "grader": "contains", "weight": 1 },
    { "id": "schema", "input": "Return JSON with an `answer` string", "expected": "{\"type\":\"object\",\"properties\":{\"answer\":{\"type\":\"string\"}},\"required\":[\"answer\"]}", "grader": "json_schema", "weight": 2 }
  ]
}
```
