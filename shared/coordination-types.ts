import type { AgentConfig } from './agent-config';

export type CoordinationRole = 'none' | 'manager' | 'lead' | 'specialist';

export interface AgentCoordinationConfig {
  role: CoordinationRole;
  capabilities: string[];
  maxConcurrentTasks: number;
}

export const DEFAULT_COORDINATION_CONFIG: AgentCoordinationConfig = {
  role: 'none',
  capabilities: [],
  maxConcurrentTasks: 1,
};

export type WorkflowStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'paused'
  | 'stop_requested'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'needs_human_input'
  | 'stopped_by_user'
  | 'stopped_by_watchdog';

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type WorkflowPriority = 'low' | 'medium' | 'high' | 'urgent';

export type DeliverableType =
  | 'text'
  | 'code'
  | 'file'
  | 'report'
  | 'decision'
  | 'tool_result';

export interface WorkflowBudget {
  maxTokens?: number;
  maxCostUsd?: number;
  maxRuntimeSeconds?: number;
  maxToolCalls?: number;
  maxAgentTurns?: number;
  maxSubtasks?: number;
}

export const DEFAULT_WORKFLOW_BUDGET: Required<
  Pick<WorkflowBudget, 'maxRuntimeSeconds' | 'maxToolCalls' | 'maxAgentTurns' | 'maxSubtasks'>
> = {
  maxRuntimeSeconds: 3600,
  maxToolCalls: 50,
  maxAgentTurns: 20,
  maxSubtasks: 20,
};

export interface CoordinationAgentRecord {
  agentId: string;
  name: string;
  role: CoordinationRole;
  capabilities: string[];
  maxConcurrentTasks: number;
  available: boolean;
  unavailableReasons: string[];
  configHash: string;
  updatedAt: string;
}

export interface CoordinationAgentSyncItem {
  config: AgentConfig;
}

export interface Workflow {
  id: string;
  title: string;
  objective: string;
  ownerAgentId: string;
  createdBy: 'user' | 'agent' | 'system';
  status: WorkflowStatus;
  priority: WorkflowPriority;
  budget: WorkflowBudget;
  successCriteria: string[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

export interface Task {
  id: string;
  workflowId: string;
  parentTaskId?: string;
  title: string;
  description: string;
  assignedAgentId: string;
  status: TaskStatus;
  dependencies: string[];
  deliverableType: DeliverableType;
  acceptanceCriteria: string[];
  result?: unknown;
  error?: string;
  runId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

export type CoordinationEventType =
  | 'workflow_created'
  | 'workflow_started'
  | 'workflow_paused'
  | 'workflow_resumed'
  | 'workflow_stop_requested'
  | 'workflow_stopped'
  | 'workflow_completed'
  | 'task_assigned'
  | 'task_started'
  | 'task_updated'
  | 'task_blocked'
  | 'task_completed'
  | 'task_failed'
  | 'task_cancelled'
  | 'run_accepted'
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'model_called'
  | 'tool_called'
  | 'budget_warning'
  | 'report_submitted';

export interface CoordinationEvent {
  id: string;
  workflowId: string;
  taskId?: string;
  agentId?: string;
  runId?: string;
  type: CoordinationEventType;
  payload: unknown;
  timestamp: string;
}

export interface WorkflowReport {
  id: string;
  workflowId: string;
  agentId?: string;
  type: 'manager_rollup' | 'agent_status' | 'stop_report';
  status: WorkflowStatus;
  summary: unknown;
  createdAt: string;
}

export interface CreateWorkflowInput {
  title: string;
  objective: string;
  ownerAgentId?: string;
  priority?: WorkflowPriority;
  budget?: WorkflowBudget;
  successCriteria?: string[];
}

export interface AssignTaskInput {
  workflowId: string;
  parentTaskId?: string;
  title: string;
  description: string;
  assignedAgentId: string;
  dependencies?: string[];
  deliverableType?: DeliverableType;
  acceptanceCriteria?: string[];
}

export interface TaskUpdateInput {
  taskId: string;
  summary?: string;
  status?: TaskStatus;
  result?: unknown;
}

export interface TaskBlockedInput {
  taskId: string;
  reason: string;
  requestedDecision?: string;
}

export interface TaskCompleteInput {
  taskId: string;
  summary: string;
  deliverable?: unknown;
}

export interface WorkflowSummary {
  workflow: Workflow;
  taskCounts: Record<TaskStatus, number>;
  latestReport?: WorkflowReport;
  blockedTasks: Task[];
}

export interface WorkflowDetail extends WorkflowSummary {
  tasks: Task[];
}

export interface CoordinationDashboard {
  agents: CoordinationAgentRecord[];
  workflows: WorkflowSummary[];
}

export interface StopReportSummary {
  workflowId: string;
  status: WorkflowStatus;
  completedTasks: Task[];
  cancelledTasks: Task[];
  openTasks: Task[];
  openQuestions: string[];
  risks: string[];
  recommendedRestartPoint: string;
}

