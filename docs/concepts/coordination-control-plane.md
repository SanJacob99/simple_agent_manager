# Coordination Control Plane

> Durable manager-led workflow coordination for canvas agents.

<!-- source: server/coordination/coordination-service.ts -->
<!-- last-verified: 2026-07-12 -->

## Overview

The coordination control plane lets one canvas Agent act as a Manager while other canvas Agents act as Leads or Specialists. The Manager talks to the user, creates workflows, assigns bounded tasks, requests reports, and pauses/resumes/stops work through deterministic APIs.

This layer does not replace `AgentManager` or `RunCoordinator`. It stores workflow/task/event state in SQLite, then uses `AgentManager` only as the dispatch gateway for actual agent runs. Sub-Agent nodes remain one-shot child calls, and Agent Comm channels remain bounded peer messaging; V1 coordination does not add unrestricted peer-to-peer authority.

## Configuration

Agent roles live on `AgentNodeData.coordination` and resolve into `AgentConfig.coordination`.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `role` | `'none' \| 'manager' \| 'lead' \| 'specialist'` | `'none'` | Control-plane authority for this agent |
| `capabilities` | `string[]` | `[]` | Freeform capability tags used by managers and the workflow console |
| `maxConcurrentTasks` | `number` | `1` | Declared task concurrency limit for future scheduling policy |

Each `Workflow` also carries a `budget` (`WorkflowBudget` in `shared/coordination-types.ts`), set at creation and enforced by `CoordinationService`:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxTokens` | `number` \| `undefined` | none | Reserved; not yet enforced by `CoordinationService`. |
| `maxCostUsd` | `number` \| `undefined` | none | Reserved; not yet enforced by `CoordinationService`. |
| `maxRuntimeSeconds` | `number` | `3600` | Wall-clock budget from `workflow.startedAt`. A watchdog timer force-stops the workflow once this elapses. |
| `maxToolCalls` | `number` | `50` | Total `tool_called` events across the workflow before `enforceBudgets` pauses it. |
| `maxAgentTurns` | `number` | `20` | Total `model_called` events across the workflow before `enforceBudgets` pauses it. |
| `maxSubtasks` | `number` | `20` | Maximum number of tasks a manager may create for the workflow. |

## Runtime Behavior

1. When a manager-role Chat Drawer opens, the frontend resolves every canvas Agent into `AgentConfig` and posts them to `/api/coordination/agents/sync`.
2. `CoordinationService` validates each synced config. An agent is unavailable when it lacks a Provider, Storage, Context Engine, or a coordination role.
3. Manager-role runs receive workflow lifecycle tools such as `coordination_create_workflow`, `coordination_assign_task`, `coordination_stop_workflow`, and trace/report tools.
4. Lead and Specialist runs receive only task tools: `coordination_task_update`, `coordination_task_blocked`, and `coordination_task_complete`.
5. Assigned tasks dispatch through `AgentManager.dispatch()` using session keys shaped like `agent:<agentId>:workflow:<workflowId>:task:<taskId>`.
6. `CoordinationService` subscribes to the assigned run's coordinator events and appends trace events for run start/end, model calls, tool calls, task completion/failure, budget warnings, and reports. `enforceBudgets` pauses the workflow and aborts the active run once `maxAgentTurns` or `maxToolCalls` is exceeded, appending a `budget_warning` event.
7. Stop marks the workflow `stop_requested`, aborts active assigned runs through `RunCoordinator.abort()`, cancels open tasks, writes a stop report, and marks the workflow `stopped_by_user`.
8. `start`/`resume` arm a per-workflow watchdog timer keyed off `budget.maxRuntimeSeconds` (measured from `startedAt`). If the deadline elapses before the workflow reaches a terminal status, the watchdog aborts any in-flight runs, cancels still-open tasks (`task_cancelled` events), and moves the workflow to `stopped_by_watchdog`. The timer is cleared on any terminal transition.
9. `completeWorkflowIfDone` fires after every task reaches a terminal state (`completed`, `failed`, or `cancelled`) — not only when all tasks complete. If every task completed, the workflow moves to `completed`; otherwise it moves to `failed`, with a `workflow_stopped` event listing the failed/cancelled task ids.

## Persistence

The default database is:

```txt
~/.simple-agent-manager/coordination/coordination.db
```

Tables:

| Table | Purpose |
|-------|---------|
| `coordination_agents` | Last synced canvas agent configs, role metadata, config hash, and availability reasons |
| `workflows` | Durable workflow lifecycle state and budgets |
| `tasks` | Assigned task state, run linkage, results, and blockers |
| `coordination_events` | Append-only trace events |
| `reports` | Manager rollups, agent reports, and stop reports |

## API Surface

REST routes are mounted under `/api/coordination`:

- `POST /agents/sync`
- `GET /agents`
- `GET /workflows`
- `POST /workflows`
- `GET /workflows/:workflowId`
- `POST /workflows/:workflowId/start`
- `POST /workflows/:workflowId/pause`
- `POST /workflows/:workflowId/resume`
- `POST /workflows/:workflowId/stop`
- `POST /workflows/:workflowId/report`
- `GET /workflows/:workflowId/trace`
- `POST /tasks`
- `POST /tasks/:taskId/update`
- `POST /tasks/:taskId/blocked`
- `POST /tasks/:taskId/complete`

## Example

```json
{
  "coordination": {
    "role": "lead",
    "capabilities": ["frontend", "tests"],
    "maxConcurrentTasks": 1
  }
}
```

