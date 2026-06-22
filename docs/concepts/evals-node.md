# Evals Node

> Attaches a suite of test cases to an agent and scores its responses against deterministic and (planned) LLM-judge assertions.

<!-- source: src/types/nodes.ts#EvalsNodeData -->
<!-- last-verified: 2026-06-22 -->

## Overview

The Evals node brings eval-driven development to the canvas. You attach it to an
agent, define a set of test cases — each an input prompt plus one or more
assertions about the response — and use them as a regression suite that you can
re-run whenever you change the prompt, model, tools, or context settings. This
mirrors the workflow popularized by tools like OpenAI Evals, Promptfoo, and
Braintrust: pin down expected behavior, then watch the pass rate as the agent
evolves.

It is a sibling to the Guardrails node. Guardrails enforce policy on live
traffic; Evals measure quality offline against a fixed dataset. Both attach to
an agent as peripheral nodes and both resolve into the agent's `AgentConfig`.

This node is a **scaffold / extension surface**. The deterministic scoring core
(`server/runtime/evals-engine.ts`) is implemented and unit-tested. Driving a
full agent run per case, and grading `llm_judge` assertions with a judge model,
is not yet wired into the run coordinator — see [Runtime Behavior](#runtime-behavior).

## Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `label` | `string` | `"Evals"` | Display name on the canvas and in result reporting. |
| `enabled` | `boolean` | `true` | When false, the suite is wired into the graph but the runner never executes it. |
| `cases` | `EvalCase[]` | `[]` | The test cases. Each has an `id`, `name`, an `input` prompt, and a list of `assertions`. |
| `passThreshold` | `number` | `1` | Fraction (0–1) of a case's assertions that must pass for the case to count as a pass. `1` means every assertion must pass. |
| `judgeModelId` | `string` | `""` | Model used to grade `llm_judge` assertions. Empty inherits the agent's model. |
| `maxConcurrency` | `number` | `2` | Upper bound on cases executed in parallel when the runner is invoked. |

### Assertion types

| Type | Grades pass when… |
|------|-------------------|
| `contains` | the response includes the given substring |
| `not_contains` | the response does **not** include the given substring |
| `equals` | the response (trimmed) exactly matches the given text |
| `regex` | the response matches the given JavaScript regular expression |
| `llm_judge` | a judge model grades the response against the rubric (reported as `pending` until the judge pass is wired) |

`contains`, `not_contains`, and `equals` honor an optional `caseSensitive` flag
(default false).

Properties are derived from the TypeScript interface in `src/types/nodes.ts` and
defaults from `src/utils/default-nodes.ts`.

## Runtime Behavior

`resolveAgentConfig()` in `src/utils/graph-to-agent.ts` collects every connected
Evals node into `AgentConfig.evals` as an array of `ResolvedEvalConfig`. Each
entry keeps its source `evalNodeId` so suite-run results can be correlated back
to the node that defined them.

Scoring lives in `server/runtime/evals-engine.ts` and is pure (no I/O, no model
calls):

- `scoreAssertion(assertion, output)` grades one assertion. `contains`,
  `not_contains`, `equals`, and `regex` are graded immediately; `llm_judge`
  returns status `pending`.
- `scoreCase(case, output, passThreshold)` grades all of a case's assertions and
  computes a `score` (fraction of resolved assertions that passed). A case
  `passed` only when no assertion is pending and `score >= passThreshold`.
- `scoreSuite(suite, outputsByCaseId)` aggregates case results into pass/fail/
  pending counts and an overall `passRate`.

**Not yet implemented:** an orchestration loop that executes the agent once per
case to produce the response strings `scoreSuite` consumes, and a judge-model
pass that resolves `llm_judge` assertions. Until that lands, the engine is
exercised by its unit tests (`server/runtime/evals-engine.test.ts`) and by any
caller that supplies its own per-case outputs.

## Connections

The Evals node connects **to an agent node** (peripheral → agent), like other
peripheral nodes. An agent may have more than one Evals node; each resolves to
its own suite. Evals nodes do not connect to other peripheral nodes.

## Example

A suite with one case that checks the agent greets politely and never leaks an
internal codename:

```json
{
  "label": "Greeting suite",
  "enabled": true,
  "passThreshold": 1,
  "judgeModelId": "",
  "maxConcurrency": 2,
  "cases": [
    {
      "id": "case_greet",
      "name": "Polite greeting",
      "input": "Say hello to a new user.",
      "assertions": [
        { "id": "a1", "type": "contains", "value": "hello" },
        { "id": "a2", "type": "not_contains", "value": "Project Bluebird" }
      ]
    }
  ]
}
```
