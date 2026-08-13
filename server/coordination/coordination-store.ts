import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import type { AgentConfig } from '../../shared/agent-config';
import type {
  AssignTaskInput,
  CoordinationAgentRecord,
  CoordinationEvent,
  CoordinationEventType,
  CreateWorkflowInput,
  StopReportSummary,
  Task,
  TaskStatus,
  Workflow,
  WorkflowBudget,
  WorkflowDetail,
  WorkflowPriority,
  WorkflowReport,
  WorkflowStatus,
  WorkflowSummary,
} from '../../shared/coordination-types';
import { DEFAULT_WORKFLOW_BUDGET } from '../../shared/coordination-types';

type SqliteDb = Database.Database;

export interface SyncedAgentRecord extends CoordinationAgentRecord {
  config: AgentConfig;
}

interface WorkflowRow {
  id: string;
  title: string;
  objective: string;
  owner_agent_id: string;
  created_by: 'user' | 'agent' | 'system';
  status: WorkflowStatus;
  priority: WorkflowPriority;
  budget_json: string;
  success_criteria_json: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

interface TaskRow {
  id: string;
  workflow_id: string;
  parent_task_id: string | null;
  title: string;
  description: string;
  assigned_agent_id: string;
  status: TaskStatus;
  dependencies_json: string;
  deliverable_type: Task['deliverableType'];
  acceptance_criteria_json: string;
  result_json: string | null;
  error: string | null;
  run_id: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

interface AgentRow {
  agent_id: string;
  name: string;
  role: CoordinationAgentRecord['role'];
  capabilities_json: string;
  max_concurrent_tasks: number;
  config_json: string;
  config_hash: string;
  available: 0 | 1;
  unavailable_reasons_json: string;
  updated_at: string;
}

interface EventRow {
  id: string;
  workflow_id: string;
  task_id: string | null;
  agent_id: string | null;
  run_id: string | null;
  type: CoordinationEventType;
  payload_json: string;
  timestamp: string;
}

interface ReportRow {
  id: string;
  workflow_id: string;
  agent_id: string | null;
  type: WorkflowReport['type'];
  status: WorkflowStatus;
  summary_json: string;
  created_at: string;
}

const TASK_STATUSES: TaskStatus[] = [
  'pending',
  'running',
  'blocked',
  'completed',
  'failed',
  'cancelled',
];

export function defaultCoordinationDbPath(): string {
  return path.join(os.homedir(), '.simple-agent-manager', 'coordination', 'coordination.db');
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function asJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function mergeBudget(input?: WorkflowBudget): WorkflowBudget {
  return {
    ...DEFAULT_WORKFLOW_BUDGET,
    ...(input ?? {}),
  };
}

function toWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    title: row.title,
    objective: row.objective,
    ownerAgentId: row.owner_agent_id,
    createdBy: row.created_by,
    status: row.status,
    priority: row.priority,
    budget: parseJson<WorkflowBudget>(row.budget_json, {}),
    successCriteria: parseJson<string[]>(row.success_criteria_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
  };
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    parentTaskId: row.parent_task_id ?? undefined,
    title: row.title,
    description: row.description,
    assignedAgentId: row.assigned_agent_id,
    status: row.status,
    dependencies: parseJson<string[]>(row.dependencies_json, []),
    deliverableType: row.deliverable_type,
    acceptanceCriteria: parseJson<string[]>(row.acceptance_criteria_json, []),
    result: row.result_json ? parseJson<unknown>(row.result_json, undefined) : undefined,
    error: row.error ?? undefined,
    runId: row.run_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
  };
}

function toAgent(row: AgentRow): SyncedAgentRecord {
  return {
    agentId: row.agent_id,
    name: row.name,
    role: row.role,
    capabilities: parseJson<string[]>(row.capabilities_json, []),
    maxConcurrentTasks: row.max_concurrent_tasks,
    config: parseJson<AgentConfig>(row.config_json, {} as AgentConfig),
    configHash: row.config_hash,
    available: row.available === 1,
    unavailableReasons: parseJson<string[]>(row.unavailable_reasons_json, []),
    updatedAt: row.updated_at,
  };
}

function toEvent(row: EventRow): CoordinationEvent {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    taskId: row.task_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    runId: row.run_id ?? undefined,
    type: row.type,
    payload: parseJson<unknown>(row.payload_json, null),
    timestamp: row.timestamp,
  };
}

function toReport(row: ReportRow): WorkflowReport {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    agentId: row.agent_id ?? undefined,
    type: row.type,
    status: row.status,
    summary: parseJson<unknown>(row.summary_json, null),
    createdAt: row.created_at,
  };
}

export class CoordinationStore {
  private readonly db: SqliteDb;

  constructor(dbPath = defaultCoordinationDbPath()) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS coordination_agents (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        capabilities_json TEXT NOT NULL,
        max_concurrent_tasks INTEGER NOT NULL,
        config_json TEXT NOT NULL,
        config_hash TEXT NOT NULL,
        available INTEGER NOT NULL,
        unavailable_reasons_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        objective TEXT NOT NULL,
        owner_agent_id TEXT NOT NULL,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        budget_json TEXT NOT NULL,
        success_criteria_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        parent_task_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        assigned_agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        dependencies_json TEXT NOT NULL,
        deliverable_type TEXT NOT NULL,
        acceptance_criteria_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        FOREIGN KEY(workflow_id) REFERENCES workflows(id)
      );

      CREATE TABLE IF NOT EXISTS coordination_events (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        task_id TEXT,
        agent_id TEXT,
        run_id TEXT,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        agent_id TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_workflow ON tasks(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_run ON tasks(run_id);
      CREATE INDEX IF NOT EXISTS idx_events_workflow_time ON coordination_events(workflow_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_reports_workflow_time ON reports(workflow_id, created_at);
    `);
  }

  syncAgents(records: SyncedAgentRecord[]): CoordinationAgentRecord[] {
    const stmt = this.db.prepare(`
      INSERT INTO coordination_agents (
        agent_id, name, role, capabilities_json, max_concurrent_tasks,
        config_json, config_hash, available, unavailable_reasons_json, updated_at
      ) VALUES (
        @agentId, @name, @role, @capabilitiesJson, @maxConcurrentTasks,
        @configJson, @configHash, @available, @unavailableReasonsJson, @updatedAt
      )
      ON CONFLICT(agent_id) DO UPDATE SET
        name = excluded.name,
        role = excluded.role,
        capabilities_json = excluded.capabilities_json,
        max_concurrent_tasks = excluded.max_concurrent_tasks,
        config_json = excluded.config_json,
        config_hash = excluded.config_hash,
        available = excluded.available,
        unavailable_reasons_json = excluded.unavailable_reasons_json,
        updated_at = excluded.updated_at
    `);
    const txn = this.db.transaction((items: SyncedAgentRecord[]) => {
      for (const record of items) {
        stmt.run({
          agentId: record.agentId,
          name: record.name,
          role: record.role,
          capabilitiesJson: asJson(record.capabilities),
          maxConcurrentTasks: record.maxConcurrentTasks,
          configJson: asJson(record.config),
          configHash: record.configHash,
          available: record.available ? 1 : 0,
          unavailableReasonsJson: asJson(record.unavailableReasons),
          updatedAt: record.updatedAt,
        });
      }
    });
    txn(records);
    return this.listAgents();
  }

  listAgents(): CoordinationAgentRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM coordination_agents ORDER BY role, name')
      .all() as AgentRow[];
    return rows.map((row) => {
      const { config: _config, ...agent } = toAgent(row);
      return agent;
    });
  }

  getAgent(agentId: string): SyncedAgentRecord | null {
    const row = this.db
      .prepare('SELECT * FROM coordination_agents WHERE agent_id = ?')
      .get(agentId) as AgentRow | undefined;
    return row ? toAgent(row) : null;
  }

  createWorkflow(id: string, input: CreateWorkflowInput, ownerAgentId: string): Workflow {
    const timestamp = nowIso();
    const workflow: Workflow = {
      id,
      title: input.title,
      objective: input.objective,
      ownerAgentId,
      createdBy: 'agent',
      status: 'draft',
      priority: input.priority ?? 'medium',
      budget: mergeBudget(input.budget),
      successCriteria: input.successCriteria ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.prepare(`
      INSERT INTO workflows (
        id, title, objective, owner_agent_id, created_by, status, priority,
        budget_json, success_criteria_json, created_at, updated_at, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workflow.id,
      workflow.title,
      workflow.objective,
      workflow.ownerAgentId,
      workflow.createdBy,
      workflow.status,
      workflow.priority,
      asJson(workflow.budget),
      asJson(workflow.successCriteria),
      workflow.createdAt,
      workflow.updatedAt,
      null,
      null,
    );
    return workflow;
  }

  getWorkflow(workflowId: string): Workflow | null {
    const row = this.db
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .get(workflowId) as WorkflowRow | undefined;
    return row ? toWorkflow(row) : null;
  }

  listWorkflowSummaries(): WorkflowSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM workflows ORDER BY updated_at DESC')
      .all() as WorkflowRow[];
    return rows.map((row) => this.buildSummary(toWorkflow(row)));
  }

  getWorkflowDetail(workflowId: string): WorkflowDetail | null {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) return null;
    return {
      ...this.buildSummary(workflow),
      tasks: this.listTasks(workflowId),
    };
  }

  updateWorkflow(
    workflowId: string,
    patch: Partial<Pick<Workflow, 'status' | 'startedAt' | 'endedAt' | 'updatedAt'>>,
  ): Workflow | null {
    const existing = this.getWorkflow(workflowId);
    if (!existing) return null;
    const next = {
      status: patch.status ?? existing.status,
      startedAt: patch.startedAt ?? existing.startedAt ?? null,
      endedAt: patch.endedAt ?? existing.endedAt ?? null,
      updatedAt: patch.updatedAt ?? nowIso(),
    };
    this.db.prepare(`
      UPDATE workflows
      SET status = ?, started_at = ?, ended_at = ?, updated_at = ?
      WHERE id = ?
    `).run(next.status, next.startedAt, next.endedAt, next.updatedAt, workflowId);
    return this.getWorkflow(workflowId);
  }

  createTask(id: string, input: AssignTaskInput): Task {
    const timestamp = nowIso();
    const task: Task = {
      id,
      workflowId: input.workflowId,
      parentTaskId: input.parentTaskId,
      title: input.title,
      description: input.description,
      assignedAgentId: input.assignedAgentId,
      status: 'pending',
      dependencies: input.dependencies ?? [],
      deliverableType: input.deliverableType ?? 'text',
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.prepare(`
      INSERT INTO tasks (
        id, workflow_id, parent_task_id, title, description, assigned_agent_id,
        status, dependencies_json, deliverable_type, acceptance_criteria_json,
        result_json, error, run_id, created_at, updated_at, started_at, ended_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.workflowId,
      task.parentTaskId ?? null,
      task.title,
      task.description,
      task.assignedAgentId,
      task.status,
      asJson(task.dependencies),
      task.deliverableType,
      asJson(task.acceptanceCriteria),
      null,
      null,
      null,
      task.createdAt,
      task.updatedAt,
      null,
      null,
    );
    this.touchWorkflow(task.workflowId);
    return task;
  }

  getTask(taskId: string): Task | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(taskId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  getTaskByRun(runId: string): Task | null {
    const row = this.db
      .prepare('SELECT * FROM tasks WHERE run_id = ?')
      .get(runId) as TaskRow | undefined;
    return row ? toTask(row) : null;
  }

  listTasks(workflowId: string): Task[] {
    const rows = this.db
      .prepare('SELECT * FROM tasks WHERE workflow_id = ? ORDER BY created_at ASC')
      .all(workflowId) as TaskRow[];
    return rows.map(toTask);
  }

  listReadyPendingTasks(workflowId: string): Task[] {
    const tasks = this.listTasks(workflowId);
    // ⚡ Bolt Optimization: Use reduce to populate an array for the Set in a single pass,
    // avoiding the intermediate array allocation of .filter().map()
    const completed = new Set(
      tasks.reduce<string[]>((acc, t) => {
        if (t.status === 'completed') acc.push(t.id);
        return acc;
      }, [])
    );
    return tasks.filter(
      (task) =>
        task.status === 'pending'
        && task.dependencies.every((dependencyId) => completed.has(dependencyId)),
    );
  }

  updateTask(taskId: string, patch: Partial<Task>): Task | null {
    const existing = this.getTask(taskId);
    if (!existing) return null;
    const status = patch.status ?? existing.status;
    const now = nowIso();
    const startedAt =
      patch.startedAt
      ?? existing.startedAt
      ?? (status === 'running' ? now : undefined);
    const endedAt =
      patch.endedAt
      ?? existing.endedAt
      ?? (['completed', 'failed', 'cancelled'].includes(status) ? now : undefined);
    this.db.prepare(`
      UPDATE tasks
      SET status = ?,
          result_json = ?,
          error = ?,
          run_id = ?,
          updated_at = ?,
          started_at = ?,
          ended_at = ?
      WHERE id = ?
    `).run(
      status,
      patch.result !== undefined ? asJson(patch.result) : (existing.result !== undefined ? asJson(existing.result) : null),
      patch.error ?? existing.error ?? null,
      patch.runId ?? existing.runId ?? null,
      patch.updatedAt ?? now,
      startedAt ?? null,
      endedAt ?? null,
      taskId,
    );
    this.touchWorkflow(existing.workflowId);
    return this.getTask(taskId);
  }

  cancelOpenTasks(workflowId: string, reason: string): Task[] {
    const openTasks = this.listTasks(workflowId).filter((task) =>
      task.status === 'pending' || task.status === 'blocked' || task.status === 'running',
    );
    for (const task of openTasks) {
      this.updateTask(task.id, { status: 'cancelled', error: reason });
    }
    return openTasks.map((task) => this.getTask(task.id)).filter((task): task is Task => !!task);
  }

  appendEvent(event: CoordinationEvent): CoordinationEvent {
    this.db.prepare(`
      INSERT INTO coordination_events (
        id, workflow_id, task_id, agent_id, run_id, type, payload_json, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.workflowId,
      event.taskId ?? null,
      event.agentId ?? null,
      event.runId ?? null,
      event.type,
      asJson(event.payload),
      event.timestamp,
    );
    this.touchWorkflow(event.workflowId);
    return event;
  }

  listEvents(workflowId: string, limit = 200): CoordinationEvent[] {
    const rows = this.db
      .prepare(`
        SELECT * FROM coordination_events
        WHERE workflow_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `)
      .all(workflowId, Math.max(1, Math.min(limit, 1000))) as EventRow[];
    return rows.reverse().map(toEvent);
  }

  countEvents(workflowId: string, type: CoordinationEventType): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM coordination_events WHERE workflow_id = ? AND type = ?')
      .get(workflowId, type) as { count: number };
    return row.count;
  }

  createReport(report: WorkflowReport): WorkflowReport {
    this.db.prepare(`
      INSERT INTO reports (id, workflow_id, agent_id, type, status, summary_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      report.id,
      report.workflowId,
      report.agentId ?? null,
      report.type,
      report.status,
      asJson(report.summary),
      report.createdAt,
    );
    this.touchWorkflow(report.workflowId);
    return report;
  }

  latestReport(workflowId: string): WorkflowReport | undefined {
    const row = this.db
      .prepare('SELECT * FROM reports WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(workflowId) as ReportRow | undefined;
    return row ? toReport(row) : undefined;
  }

  makeStopSummary(workflowId: string, status: WorkflowStatus): StopReportSummary {
    const tasks = this.listTasks(workflowId);
    const completedTasks = tasks.filter((task) => task.status === 'completed');
    const cancelledTasks = tasks.filter((task) => task.status === 'cancelled');
    const openTasks = tasks.filter((task) =>
      task.status === 'pending' || task.status === 'running' || task.status === 'blocked',
    );
    const openQuestions = tasks
      .filter((task) => task.status === 'blocked')
      .map((task) => task.error ?? `${task.title} is blocked`);
    return {
      workflowId,
      status,
      completedTasks,
      cancelledTasks,
      openTasks,
      openQuestions,
      risks: openTasks.map((task) => `Incomplete task: ${task.title}`),
      recommendedRestartPoint:
        openTasks[0]?.id
          ? `Resume from task ${openTasks[0].id} (${openTasks[0].title}).`
          : 'No open tasks remain.',
    };
  }

  private buildSummary(workflow: Workflow): WorkflowSummary {
    const tasks = this.listTasks(workflow.id);
    const taskCounts = TASK_STATUSES.reduce((acc, status) => {
      acc[status] = tasks.filter((task) => task.status === status).length;
      return acc;
    }, {} as Record<TaskStatus, number>);
    return {
      workflow,
      taskCounts,
      latestReport: this.latestReport(workflow.id),
      blockedTasks: tasks.filter((task) => task.status === 'blocked'),
    };
  }

  private touchWorkflow(workflowId: string): void {
    this.db
      .prepare('UPDATE workflows SET updated_at = ? WHERE id = ?')
      .run(nowIso(), workflowId);
  }
}
