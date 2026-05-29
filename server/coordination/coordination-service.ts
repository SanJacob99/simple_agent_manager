import { createHash, randomUUID } from 'crypto';
import type { AgentConfig } from '../../shared/agent-config';
import type {
  AssignTaskInput,
  CoordinationAgentRecord,
  CoordinationAgentSyncItem,
  CoordinationEvent,
  CoordinationEventType,
  CreateWorkflowInput,
  Task,
  TaskBlockedInput,
  TaskCompleteInput,
  TaskStatus,
  TaskUpdateInput,
  Workflow,
  WorkflowDetail,
  WorkflowReport,
  WorkflowStatus,
  WorkflowSummary,
} from '../../shared/coordination-types';
import type { CoordinatorEvent, DispatchResult, RunEventListener } from '../../shared/run-types';
import { CoordinationStore, type SyncedAgentRecord } from './coordination-store';

export interface AgentDispatchGateway {
  ensureAgentStarted(config: AgentConfig): Promise<void>;
  listManagedAgentConfigs?(): AgentConfig[];
  dispatch(agentId: string, params: { sessionKey: string; text: string; timeoutMs?: number }): Promise<DispatchResult>;
  subscribe(agentId: string, runId: string, listener: RunEventListener): () => void;
  abortRun(agentId: string, runId: string): void;
}

interface ActiveAssignment {
  workflowId: string;
  taskId: string;
  agentId: string;
  runId: string;
  unsubscribe: () => void;
}

const TERMINAL_WORKFLOW_STATUSES: WorkflowStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'stopped_by_user',
  'stopped_by_watchdog',
];

function nowIso(): string {
  return new Date().toISOString();
}

function hashConfig(config: AgentConfig): string {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

function availableReasons(config: AgentConfig): string[] {
  const reasons: string[] = [];
  if (!config.provider?.pluginId) reasons.push('missing_provider');
  if (!config.storage) reasons.push('missing_storage');
  if (!config.contextEngine) reasons.push('missing_context_engine');
  if ((config.coordination?.role ?? 'none') === 'none') reasons.push('role_none');
  return reasons;
}

function isTerminalWorkflow(status: WorkflowStatus): boolean {
  return TERMINAL_WORKFLOW_STATUSES.includes(status);
}

function collectTextPayloads(event: CoordinatorEvent): string | undefined {
  if (event.type !== 'lifecycle:end') return undefined;
  const text = event.payloads
    .filter((payload) => payload.type === 'text')
    .map((payload) => payload.content)
    .join('\n\n')
    .trim();
  return text || undefined;
}

export class CoordinationService {
  private gateway: AgentDispatchGateway | null = null;
  private readonly activeAssignments = new Map<string, ActiveAssignment>();
  private readonly dispatchChains = new Map<string, Promise<void>>();
  private readonly watchdogTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly store: CoordinationStore) {}

  setGateway(gateway: AgentDispatchGateway): void {
    this.gateway = gateway;
    this.syncManagedAgentsFromGateway();
  }

  close(): void {
    for (const assignment of this.activeAssignments.values()) {
      assignment.unsubscribe();
    }
    this.activeAssignments.clear();
    for (const timer of this.watchdogTimers.values()) {
      clearTimeout(timer);
    }
    this.watchdogTimers.clear();
    this.store.close();
  }

  syncAgents(input: { agents: CoordinationAgentSyncItem[] }): CoordinationAgentRecord[] {
    const records: SyncedAgentRecord[] = input.agents.map(({ config }) => {
      const coordination = config.coordination ?? {
        role: 'none' as const,
        capabilities: [],
        maxConcurrentTasks: 1,
      };
      const reasons = availableReasons(config);
      return {
        agentId: config.id,
        name: config.name || config.id,
        role: coordination.role,
        capabilities: coordination.capabilities ?? [],
        maxConcurrentTasks: Math.max(1, Number(coordination.maxConcurrentTasks ?? 1)),
        config,
        configHash: hashConfig(config),
        available: reasons.length === 0,
        unavailableReasons: reasons,
        updatedAt: nowIso(),
      };
    });
    return this.store.syncAgents(records);
  }

  listAgents(): CoordinationAgentRecord[] {
    return this.store.listAgents();
  }

  listWorkflowSummaries(): WorkflowSummary[] {
    return this.store.listWorkflowSummaries();
  }

  getWorkflowDetail(workflowId: string): WorkflowDetail | null {
    return this.store.getWorkflowDetail(workflowId);
  }

  getTrace(workflowId: string, limit?: number): CoordinationEvent[] {
    return this.store.listEvents(workflowId, limit);
  }

  createWorkflow(callerAgentId: string, input: CreateWorkflowInput): Workflow {
    this.assertManager(callerAgentId);
    const ownerAgentId = input.ownerAgentId ?? callerAgentId;
    const workflow = this.store.createWorkflow(`wf_${randomUUID()}`, input, ownerAgentId);
    this.appendEvent({
      workflowId: workflow.id,
      agentId: callerAgentId,
      type: 'workflow_created',
      payload: { title: workflow.title, ownerAgentId },
    });
    return workflow;
  }

  startWorkflow(callerAgentId: string, workflowId: string): Workflow {
    this.assertManager(callerAgentId);
    const workflow = this.requireWorkflow(workflowId);
    if (isTerminalWorkflow(workflow.status)) {
      throw new Error(`Workflow ${workflowId} is terminal (${workflow.status})`);
    }
    const updated = this.store.updateWorkflow(workflowId, {
      status: 'running',
      startedAt: workflow.startedAt ?? nowIso(),
    });
    if (!updated) throw new Error(`Workflow ${workflowId} not found`);
    this.appendEvent({
      workflowId,
      agentId: callerAgentId,
      type: 'workflow_started',
      payload: { previousStatus: workflow.status },
    });
    this.armWatchdog(updated);
    void this.dispatchReadyTasks(workflowId);
    return updated;
  }

  pauseWorkflow(callerAgentId: string, workflowId: string, reason: string): Workflow {
    this.assertManager(callerAgentId);
    const workflow = this.requireWorkflow(workflowId);
    if (isTerminalWorkflow(workflow.status)) {
      throw new Error(`Workflow ${workflowId} is terminal (${workflow.status})`);
    }
    const updated = this.store.updateWorkflow(workflowId, { status: 'paused' });
    if (!updated) throw new Error(`Workflow ${workflowId} not found`);
    this.appendEvent({
      workflowId,
      agentId: callerAgentId,
      type: 'workflow_paused',
      payload: { reason },
    });
    return updated;
  }

  resumeWorkflow(callerAgentId: string, workflowId: string): Workflow {
    this.assertManager(callerAgentId);
    const workflow = this.requireWorkflow(workflowId);
    if (workflow.status !== 'paused' && workflow.status !== 'needs_human_input') {
      throw new Error(`Workflow ${workflowId} is not paused`);
    }
    const updated = this.store.updateWorkflow(workflowId, { status: 'running' });
    if (!updated) throw new Error(`Workflow ${workflowId} not found`);
    this.appendEvent({
      workflowId,
      agentId: callerAgentId,
      type: 'workflow_resumed',
      payload: {},
    });
    this.armWatchdog(updated);
    void this.dispatchReadyTasks(workflowId);
    return updated;
  }

  stopWorkflow(callerAgentId: string, workflowId: string, reason: string): WorkflowReport {
    this.assertManager(callerAgentId);
    const workflow = this.requireWorkflow(workflowId);
    if (isTerminalWorkflow(workflow.status)) {
      return this.requestReport(callerAgentId, workflowId, 'stop_report');
    }
    this.store.updateWorkflow(workflowId, { status: 'stop_requested' });
    this.appendEvent({
      workflowId,
      agentId: callerAgentId,
      type: 'workflow_stop_requested',
      payload: { reason },
    });

    for (const assignment of [...this.activeAssignments.values()]) {
      if (assignment.workflowId !== workflowId) continue;
      this.gateway?.abortRun(assignment.agentId, assignment.runId);
    }

    const cancelledTasks = this.store.cancelOpenTasks(workflowId, reason);
    for (const task of cancelledTasks) {
      this.appendEvent({
        workflowId,
        taskId: task.id,
        agentId: task.assignedAgentId,
        runId: task.runId,
        type: 'task_cancelled',
        payload: { reason },
      });
    }
    const stopped = this.store.updateWorkflow(workflowId, {
      status: 'stopped_by_user',
      endedAt: nowIso(),
    });
    if (!stopped) throw new Error(`Workflow ${workflowId} not found`);
    this.clearWatchdog(workflowId);
    this.appendEvent({
      workflowId,
      agentId: callerAgentId,
      type: 'workflow_stopped',
      payload: { reason },
    });
    return this.createReport(callerAgentId, workflowId, 'stop_report', this.store.makeStopSummary(workflowId, 'stopped_by_user'));
  }

  assignTask(callerAgentId: string, input: AssignTaskInput): Task {
    this.syncManagedAgentsFromGateway();
    this.assertManager(callerAgentId);
    const workflow = this.requireWorkflow(input.workflowId);
    if (isTerminalWorkflow(workflow.status) || workflow.status === 'stop_requested') {
      throw new Error(`Workflow ${workflow.id} cannot accept tasks while ${workflow.status}`);
    }
    const target = this.store.getAgent(input.assignedAgentId);
    if (!target) throw new Error(`Agent ${input.assignedAgentId} is not synced`);
    if (!target.available) {
      throw new Error(`Agent ${target.name} is unavailable: ${target.unavailableReasons.join(', ')}`);
    }
    const currentTasks = this.store.listTasks(workflow.id);
    const maxSubtasks = workflow.budget.maxSubtasks ?? 20;
    if (currentTasks.length >= maxSubtasks) {
      throw new Error(`Workflow ${workflow.id} reached maxSubtasks (${maxSubtasks})`);
    }

    const task = this.store.createTask(`task_${randomUUID()}`, input);
    this.appendEvent({
      workflowId: task.workflowId,
      taskId: task.id,
      agentId: input.assignedAgentId,
      type: 'task_assigned',
      payload: {
        title: task.title,
        assignedAgentId: task.assignedAgentId,
      },
    });
    void this.dispatchReadyTasks(task.workflowId);
    return task;
  }

  taskUpdate(callerAgentId: string, input: TaskUpdateInput): Task {
    const task = this.requireTaskForCaller(callerAgentId, input.taskId);
    const updated = this.store.updateTask(task.id, {
      status: input.status ?? task.status,
      result: input.result ?? (input.summary ? { summary: input.summary } : task.result),
    });
    if (!updated) throw new Error(`Task ${task.id} not found`);
    this.appendEvent({
      workflowId: task.workflowId,
      taskId: task.id,
      agentId: callerAgentId,
      runId: updated.runId,
      type: 'task_updated',
      payload: { summary: input.summary, status: updated.status },
    });
    return updated;
  }

  taskBlocked(callerAgentId: string, input: TaskBlockedInput): Task {
    const task = this.requireTaskForCaller(callerAgentId, input.taskId);
    const updated = this.store.updateTask(task.id, {
      status: 'blocked',
      error: input.requestedDecision
        ? `${input.reason} Decision needed: ${input.requestedDecision}`
        : input.reason,
    });
    if (!updated) throw new Error(`Task ${task.id} not found`);
    this.appendEvent({
      workflowId: task.workflowId,
      taskId: task.id,
      agentId: callerAgentId,
      runId: updated.runId,
      type: 'task_blocked',
      payload: input,
    });
    this.store.updateWorkflow(task.workflowId, { status: 'needs_human_input' });
    return updated;
  }

  taskComplete(callerAgentId: string, input: TaskCompleteInput): Task {
    const task = this.requireTaskForCaller(callerAgentId, input.taskId);
    const updated = this.store.updateTask(task.id, {
      status: 'completed',
      result: {
        summary: input.summary,
        deliverable: input.deliverable,
      },
    });
    if (!updated) throw new Error(`Task ${task.id} not found`);
    this.appendEvent({
      workflowId: task.workflowId,
      taskId: task.id,
      agentId: callerAgentId,
      runId: updated.runId,
      type: 'task_completed',
      payload: { summary: input.summary },
    });
    void this.dispatchReadyTasks(task.workflowId);
    this.completeWorkflowIfDone(task.workflowId);
    return updated;
  }

  requestReport(
    callerAgentId: string,
    workflowId: string,
    type: WorkflowReport['type'] = 'manager_rollup',
  ): WorkflowReport {
    this.assertManager(callerAgentId);
    const detail = this.store.getWorkflowDetail(workflowId);
    if (!detail) throw new Error(`Workflow ${workflowId} not found`);
    const summary =
      type === 'stop_report'
        ? this.store.makeStopSummary(workflowId, detail.workflow.status)
        : {
            activeWorkflows: this.store.listWorkflowSummaries().filter((w) =>
              ['running', 'paused', 'needs_human_input'].includes(w.workflow.status),
            ).length,
            workflow: detail.workflow,
            taskCounts: detail.taskCounts,
            blocked: detail.blockedTasks,
            nextActions: detail.tasks
              .filter((task) => task.status === 'pending' || task.status === 'blocked')
              .map((task) => task.title),
          };
    return this.createReport(callerAgentId, workflowId, type, summary);
  }

  private createReport(
    callerAgentId: string,
    workflowId: string,
    type: WorkflowReport['type'],
    summary: unknown,
  ): WorkflowReport {
    const workflow = this.requireWorkflow(workflowId);
    const report = this.store.createReport({
      id: `report_${randomUUID()}`,
      workflowId,
      agentId: callerAgentId,
      type,
      status: workflow.status,
      summary,
      createdAt: nowIso(),
    });
    this.appendEvent({
      workflowId,
      agentId: callerAgentId,
      type: 'report_submitted',
      payload: { reportId: report.id, reportType: type },
    });
    return report;
  }

  private dispatchReadyTasks(workflowId: string): Promise<void> {
    const previous = this.dispatchChains.get(workflowId) ?? Promise.resolve();
    let next: Promise<void> = Promise.resolve();
    next = previous
      .catch(() => undefined)
      .then(() => this.dispatchReadyTasksLocked(workflowId))
      .catch((err) => {
        console.error(
          `[CoordinationService] dispatchReadyTasks failed for ${workflowId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        if (this.dispatchChains.get(workflowId) === next) {
          this.dispatchChains.delete(workflowId);
        }
      });
    this.dispatchChains.set(workflowId, next);
    return next;
  }

  private async dispatchReadyTasksLocked(workflowId: string): Promise<void> {
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow || workflow.status !== 'running') return;
    const runningByAgent = new Map<string, number>();
    for (const task of this.store.listTasks(workflowId)) {
      if (task.status === 'running') {
        runningByAgent.set(task.assignedAgentId, (runningByAgent.get(task.assignedAgentId) ?? 0) + 1);
      }
    }
    for (const task of this.store.listReadyPendingTasks(workflowId)) {
      const agent = this.store.getAgent(task.assignedAgentId);
      const maxConcurrent = Math.max(1, agent?.maxConcurrentTasks ?? 1);
      const running = runningByAgent.get(task.assignedAgentId) ?? 0;
      if (running >= maxConcurrent) {
        continue;
      }
      runningByAgent.set(task.assignedAgentId, running + 1);
      await this.dispatchTask(task).catch((err) => {
        runningByAgent.set(
          task.assignedAgentId,
          Math.max(0, (runningByAgent.get(task.assignedAgentId) ?? 1) - 1),
        );
        const message = err instanceof Error ? err.message : String(err);
        this.store.updateTask(task.id, { status: 'failed', error: message });
        this.appendEvent({
          workflowId,
          taskId: task.id,
          agentId: task.assignedAgentId,
          type: 'task_failed',
          payload: { error: message },
        });
        this.completeWorkflowIfDone(workflowId);
      });
    }
  }

  private async dispatchTask(task: Task): Promise<void> {
    if (!this.gateway) throw new Error('CoordinationService has no dispatch gateway');
    this.syncManagedAgentsFromGateway();
    const workflow = this.requireWorkflow(task.workflowId);
    if (workflow.status !== 'running') return;
    const agent = this.store.getAgent(task.assignedAgentId);
    if (!agent) throw new Error(`Agent ${task.assignedAgentId} is not synced`);
    if (!agent.available) {
      throw new Error(`Agent ${agent.name} is unavailable: ${agent.unavailableReasons.join(', ')}`);
    }

    await this.gateway.ensureAgentStarted(agent.config);
    const sessionKey = `agent:${task.assignedAgentId}:workflow:${task.workflowId}:task:${task.id}`;
    const result = await this.gateway.dispatch(task.assignedAgentId, {
      sessionKey,
      text: this.buildTaskPrompt(workflow, task),
      timeoutMs: (workflow.budget.maxRuntimeSeconds ?? 3600) * 1000,
    });
    const updated = this.store.updateTask(task.id, {
      status: 'running',
      runId: result.runId,
      startedAt: nowIso(),
    });
    if (!updated) {
      this.gateway.abortRun(task.assignedAgentId, result.runId);
      throw new Error(`Task ${task.id} disappeared after dispatch`);
    }
    this.appendEvent({
      workflowId: task.workflowId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      runId: result.runId,
      type: 'run_accepted',
      payload: { sessionId: result.sessionId, acceptedAt: result.acceptedAt },
    });
    this.appendEvent({
      workflowId: task.workflowId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      runId: result.runId,
      type: 'task_started',
      payload: { title: task.title },
    });

    const unsubscribe = this.gateway.subscribe(task.assignedAgentId, result.runId, (event) => {
      this.handleRunEvent(task.workflowId, task.id, task.assignedAgentId, result.runId, event);
    });
    this.activeAssignments.set(result.runId, {
      workflowId: task.workflowId,
      taskId: task.id,
      agentId: task.assignedAgentId,
      runId: result.runId,
      unsubscribe,
    });
  }

  private handleRunEvent(
    workflowId: string,
    taskId: string,
    agentId: string,
    runId: string,
    event: CoordinatorEvent,
  ): void {
    if (event.type === 'lifecycle:start') {
      this.appendEvent({
        workflowId,
        taskId,
        agentId,
        runId,
        type: 'run_started',
        payload: { startedAt: event.startedAt },
      });
      this.appendEvent({
        workflowId,
        taskId,
        agentId,
        runId,
        type: 'model_called',
        payload: { source: 'lifecycle_start' },
      });
      this.enforceBudgets(workflowId, runId, agentId);
      return;
    }

    if (event.type === 'stream') {
      const raw = event.event as { type?: string; tool?: unknown; toolName?: unknown; name?: unknown };
      if (raw?.type === 'tool_execution_start') {
        this.appendEvent({
          workflowId,
          taskId,
          agentId,
          runId,
          type: 'tool_called',
          payload: {
            toolName: String(raw.toolName ?? raw.name ?? raw.tool ?? 'unknown'),
          },
        });
        this.enforceBudgets(workflowId, runId, agentId);
      }
      return;
    }

    if (event.type === 'lifecycle:end') {
      const resultText = collectTextPayloads(event);
      const current = this.store.getTask(taskId);
      if (current && current.status === 'running') {
        this.store.updateTask(taskId, {
          status: 'completed',
          result: {
            summary: resultText ?? 'Run completed.',
            usage: event.usage,
          },
        });
        this.appendEvent({
          workflowId,
          taskId,
          agentId,
          runId,
          type: 'task_completed',
          payload: { summary: resultText, usage: event.usage },
        });
      }
      this.appendEvent({
        workflowId,
        taskId,
        agentId,
        runId,
        type: 'run_completed',
        payload: { endedAt: event.endedAt, usage: event.usage },
      });
      this.finishAssignment(runId);
      void this.dispatchReadyTasks(workflowId);
      this.completeWorkflowIfDone(workflowId);
      return;
    }

    if (event.type === 'lifecycle:error') {
      const current = this.store.getTask(taskId);
      if (current?.status !== 'cancelled') {
        this.store.updateTask(taskId, {
          status: 'failed',
          error: event.error.message,
        });
        this.appendEvent({
          workflowId,
          taskId,
          agentId,
          runId,
          type: 'task_failed',
          payload: { error: event.error.message },
        });
      }
      this.appendEvent({
        workflowId,
        taskId,
        agentId,
        runId,
        type: 'run_failed',
        payload: { error: event.error },
      });
      this.finishAssignment(runId);
      void this.dispatchReadyTasks(workflowId);
      this.completeWorkflowIfDone(workflowId);
    }
  }

  private enforceBudgets(workflowId: string, activeRunId: string, activeAgentId: string): void {
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow || workflow.status !== 'running') return;
    const budget = workflow.budget;
    const turns = this.store.countEvents(workflowId, 'model_called');
    const tools = this.store.countEvents(workflowId, 'tool_called');
    const maxTurns = budget.maxAgentTurns ?? 20;
    const maxTools = budget.maxToolCalls ?? 50;
    let reason: string | null = null;
    if (turns > maxTurns) reason = `maxAgentTurns exceeded (${turns}/${maxTurns})`;
    if (tools > maxTools) reason = `maxToolCalls exceeded (${tools}/${maxTools})`;
    if (!reason) return;
    this.store.updateWorkflow(workflowId, { status: 'paused' });
    this.appendEvent({
      workflowId,
      agentId: activeAgentId,
      runId: activeRunId,
      type: 'budget_warning',
      payload: { reason, turns, tools },
    });
    this.gateway?.abortRun(activeAgentId, activeRunId);
  }

  private finishAssignment(runId: string): void {
    const assignment = this.activeAssignments.get(runId);
    if (!assignment) return;
    assignment.unsubscribe();
    this.activeAssignments.delete(runId);
  }

  /**
   * Arm (or re-arm) a workflow-level watchdog driven by `budget.maxRuntimeSeconds`.
   * If the workflow's total runtime (measured from `startedAt`) exceeds the budget,
   * the workflow and its still-open tasks are forced to a terminal
   * `stopped_by_watchdog` state so a stuck workflow can't run forever. The timer is
   * cleared whenever the workflow reaches any terminal state to avoid leaks.
   */
  private armWatchdog(workflow: Workflow): void {
    this.clearWatchdog(workflow.id);
    const maxRuntimeSeconds = workflow.budget.maxRuntimeSeconds ?? 3600;
    if (!Number.isFinite(maxRuntimeSeconds) || maxRuntimeSeconds <= 0) return;
    const startedAtMs = workflow.startedAt ? Date.parse(workflow.startedAt) : Date.now();
    const deadlineMs = (Number.isNaN(startedAtMs) ? Date.now() : startedAtMs) + maxRuntimeSeconds * 1000;
    const delayMs = Math.max(0, deadlineMs - Date.now());
    const timer = setTimeout(() => this.triggerWatchdog(workflow.id, maxRuntimeSeconds), delayMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.watchdogTimers.set(workflow.id, timer);
  }

  private clearWatchdog(workflowId: string): void {
    const timer = this.watchdogTimers.get(workflowId);
    if (timer) {
      clearTimeout(timer);
      this.watchdogTimers.delete(workflowId);
    }
  }

  private triggerWatchdog(workflowId: string, maxRuntimeSeconds: number): void {
    this.clearWatchdog(workflowId);
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow || isTerminalWorkflow(workflow.status)) return;

    const reason = `Workflow exceeded maxRuntimeSeconds (${maxRuntimeSeconds}s)`;

    // Abort any in-flight runs so the underlying agents stop working.
    for (const assignment of [...this.activeAssignments.values()]) {
      if (assignment.workflowId !== workflowId) continue;
      this.gateway?.abortRun(assignment.agentId, assignment.runId);
      this.finishAssignment(assignment.runId);
    }

    // Move still-open tasks (pending/blocked/running) to a terminal cancelled state.
    const cancelledTasks = this.store.cancelOpenTasks(workflowId, reason);
    for (const task of cancelledTasks) {
      this.appendEvent({
        workflowId,
        taskId: task.id,
        agentId: task.assignedAgentId,
        runId: task.runId,
        type: 'task_cancelled',
        payload: { reason },
      });
    }

    this.store.updateWorkflow(workflowId, { status: 'stopped_by_watchdog', endedAt: nowIso() });
    this.appendEvent({
      workflowId,
      agentId: workflow.ownerAgentId,
      type: 'workflow_stopped',
      payload: { reason, status: 'stopped_by_watchdog', maxRuntimeSeconds },
    });
  }

  private completeWorkflowIfDone(workflowId: string): void {
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow || workflow.status !== 'running') return;
    const tasks = this.store.listTasks(workflowId);
    if (tasks.length === 0) return;
    // A workflow is "done" once every task has reached a terminal state. Terminal
    // tasks are completed, failed, or cancelled — not just completed. Tasks that
    // failed (e.g. via a budget abort) are never re-dispatched (only pending tasks
    // are), so requiring every() task to be completed would hang forever.
    const TERMINAL_TASK_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled'];
    const allTerminal = tasks.every((task) => TERMINAL_TASK_STATUSES.includes(task.status));
    if (!allTerminal) return;
    const allCompleted = tasks.every((task) => task.status === 'completed');
    const status: WorkflowStatus = allCompleted ? 'completed' : 'failed';
    this.store.updateWorkflow(workflowId, { status, endedAt: nowIso() });
    this.clearWatchdog(workflowId);
    this.appendEvent({
      workflowId,
      agentId: workflow.ownerAgentId,
      type: allCompleted ? 'workflow_completed' : 'workflow_stopped',
      payload: allCompleted
        ? {}
        : {
            reason: 'tasks_failed',
            status,
            failedTasks: tasks.filter((task) => task.status === 'failed').map((task) => task.id),
            cancelledTasks: tasks.filter((task) => task.status === 'cancelled').map((task) => task.id),
          },
    });
  }

  private buildTaskPrompt(workflow: Workflow, task: Task): string {
    return [
      `You are assigned to coordination task ${task.id} in workflow ${workflow.id}.`,
      '',
      `Workflow: ${workflow.title}`,
      `Objective: ${workflow.objective}`,
      '',
      `Task: ${task.title}`,
      task.description,
      '',
      task.acceptanceCriteria.length > 0
        ? `Acceptance criteria:\n${task.acceptanceCriteria.map((item) => `- ${item}`).join('\n')}`
        : 'Acceptance criteria: complete the task and report the deliverable clearly.',
      '',
      'Use coordination_task_update for progress, coordination_task_blocked when blocked, and coordination_task_complete when done.',
    ].join('\n');
  }

  private requireWorkflow(workflowId: string): Workflow {
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    return workflow;
  }

  private requireTaskForCaller(callerAgentId: string, taskId: string): Task {
    this.syncManagedAgentsFromGateway();
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    const caller = this.store.getAgent(callerAgentId);
    if (caller?.role === 'manager') return task;
    if (task.assignedAgentId !== callerAgentId) {
      throw new Error(`Agent ${callerAgentId} cannot update task ${taskId}`);
    }
    return task;
  }

  private assertManager(agentId: string): void {
    this.syncManagedAgentsFromGateway();
    const agent = this.store.getAgent(agentId);
    if (!agent || agent.role !== 'manager') {
      throw new Error(`Agent ${agentId} does not have manager authority`);
    }
  }

  private syncManagedAgentsFromGateway(): void {
    const configs = this.gateway?.listManagedAgentConfigs?.() ?? [];
    if (configs.length === 0) return;
    this.syncAgents({ agents: configs.map((config) => ({ config })) });
  }

  private appendEvent(args: Omit<CoordinationEvent, 'id' | 'timestamp'>): CoordinationEvent {
    return this.store.appendEvent({
      id: `evt_${randomUUID()}`,
      timestamp: nowIso(),
      ...args,
    });
  }
}
