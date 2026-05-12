import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { CoordinationService } from './coordination-service';
import type { AgentConfig } from '../../shared/agent-config';

export interface CoordinationToolContext {
  service: CoordinationService;
  callerAgentId: string;
  callerRunId: string;
  callerSessionKey: string;
  config: AgentConfig;
}

function textResult(text: string, details?: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text }],
    details,
  };
}

function jsonResult(value: unknown): AgentToolResult<unknown> {
  return textResult(JSON.stringify(value, null, 2), value);
}

function errorResult(message: string): AgentToolResult<unknown> {
  return jsonResult({ status: 'error', error: message });
}

function wrap(
  fn: () => unknown | Promise<unknown>,
): Promise<AgentToolResult<unknown>> {
  return Promise.resolve()
    .then(fn)
    .then(jsonResult)
    .catch((err) => errorResult(err instanceof Error ? err.message : String(err)));
}

const WorkflowBudgetSchema = Type.Object({
  maxTokens: Type.Optional(Type.Number()),
  maxCostUsd: Type.Optional(Type.Number()),
  maxRuntimeSeconds: Type.Optional(Type.Number()),
  maxToolCalls: Type.Optional(Type.Number()),
  maxAgentTurns: Type.Optional(Type.Number()),
  maxSubtasks: Type.Optional(Type.Number()),
});

const PrioritySchema = Type.Union([
  Type.Literal('low'),
  Type.Literal('medium'),
  Type.Literal('high'),
  Type.Literal('urgent'),
]);

const DeliverableSchema = Type.Union([
  Type.Literal('text'),
  Type.Literal('code'),
  Type.Literal('file'),
  Type.Literal('report'),
  Type.Literal('decision'),
  Type.Literal('tool_result'),
]);

export function createCoordinationTools(ctx: CoordinationToolContext): AgentTool<TSchema>[] {
  const role = ctx.config.coordination?.role ?? 'none';
  const tools: AgentTool<TSchema>[] = [];

  if (role === 'manager') {
    tools.push(
      {
        name: 'coordination_create_workflow',
        label: 'Create Workflow',
        description: 'Create a durable coordination workflow. The workflow starts in draft until coordination_start_workflow is called.',
        parameters: Type.Object({
          title: Type.String(),
          objective: Type.String(),
          ownerAgentId: Type.Optional(Type.String()),
          priority: Type.Optional(PrioritySchema),
          budget: Type.Optional(WorkflowBudgetSchema),
          successCriteria: Type.Optional(Type.Array(Type.String())),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.createWorkflow(ctx.callerAgentId, params)),
      },
      {
        name: 'coordination_start_workflow',
        label: 'Start Workflow',
        description: 'Start a workflow and dispatch dependency-free pending tasks.',
        parameters: Type.Object({
          workflowId: Type.String(),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.startWorkflow(ctx.callerAgentId, params.workflowId)),
      },
      {
        name: 'coordination_assign_task',
        label: 'Assign Task',
        description: 'Assign a bounded task to a synced lead or specialist agent.',
        parameters: Type.Object({
          workflowId: Type.String(),
          parentTaskId: Type.Optional(Type.String()),
          title: Type.String(),
          description: Type.String(),
          assignedAgentId: Type.String(),
          dependencies: Type.Optional(Type.Array(Type.String())),
          deliverableType: Type.Optional(DeliverableSchema),
          acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.assignTask(ctx.callerAgentId, params)),
      },
      {
        name: 'coordination_pause_workflow',
        label: 'Pause Workflow',
        description: 'Pause a running coordination workflow.',
        parameters: Type.Object({
          workflowId: Type.String(),
          reason: Type.String(),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.pauseWorkflow(ctx.callerAgentId, params.workflowId, params.reason)),
      },
      {
        name: 'coordination_resume_workflow',
        label: 'Resume Workflow',
        description: 'Resume a paused coordination workflow.',
        parameters: Type.Object({
          workflowId: Type.String(),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.resumeWorkflow(ctx.callerAgentId, params.workflowId)),
      },
      {
        name: 'coordination_stop_workflow',
        label: 'Stop Workflow',
        description: 'Stop a workflow, abort active assigned runs, cancel queued tasks, and produce a stop report.',
        parameters: Type.Object({
          workflowId: Type.String(),
          reason: Type.String(),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.stopWorkflow(ctx.callerAgentId, params.workflowId, params.reason)),
      },
      {
        name: 'coordination_get_status',
        label: 'Workflow Status',
        description: 'Get all workflow summaries or one detailed workflow status.',
        parameters: Type.Object({
          workflowId: Type.Optional(Type.String()),
        }),
        execute: async (_id, params: any) =>
          wrap(() =>
            params.workflowId
              ? ctx.service.getWorkflowDetail(params.workflowId)
              : ctx.service.listWorkflowSummaries(),
          ),
      },
      {
        name: 'coordination_get_trace',
        label: 'Workflow Trace',
        description: 'Read the append-only trace for a workflow.',
        parameters: Type.Object({
          workflowId: Type.String(),
          limit: Type.Optional(Type.Number()),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.getTrace(params.workflowId, params.limit)),
      },
      {
        name: 'coordination_request_report',
        label: 'Request Report',
        description: 'Generate a manager rollup report for a workflow.',
        parameters: Type.Object({
          workflowId: Type.String(),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.requestReport(ctx.callerAgentId, params.workflowId)),
      },
    );
  }

  if (role === 'manager' || role === 'lead' || role === 'specialist') {
    tools.push(
      {
        name: 'coordination_task_update',
        label: 'Task Update',
        description: 'Record a progress update for an assigned coordination task.',
        parameters: Type.Object({
          taskId: Type.String(),
          summary: Type.Optional(Type.String()),
          status: Type.Optional(Type.Union([
            Type.Literal('pending'),
            Type.Literal('running'),
            Type.Literal('blocked'),
            Type.Literal('completed'),
            Type.Literal('failed'),
            Type.Literal('cancelled'),
          ])),
          result: Type.Optional(Type.Any()),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.taskUpdate(ctx.callerAgentId, params)),
      },
      {
        name: 'coordination_task_blocked',
        label: 'Task Blocked',
        description: 'Mark an assigned task blocked and record what decision or input is needed.',
        parameters: Type.Object({
          taskId: Type.String(),
          reason: Type.String(),
          requestedDecision: Type.Optional(Type.String()),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.taskBlocked(ctx.callerAgentId, params)),
      },
      {
        name: 'coordination_task_complete',
        label: 'Task Complete',
        description: 'Mark an assigned task complete with a bounded deliverable.',
        parameters: Type.Object({
          taskId: Type.String(),
          summary: Type.String(),
          deliverable: Type.Optional(Type.Any()),
        }),
        execute: async (_id, params: any) =>
          wrap(() => ctx.service.taskComplete(ctx.callerAgentId, params)),
      },
    );
  }

  return tools;
}

