import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentConfig } from '../../shared/agent-config';
import type { CoordinatorEvent, RunEventListener } from '../../shared/run-types';
import { CoordinationStore } from './coordination-store';
import { CoordinationService, type AgentDispatchGateway } from './coordination-service';
import { createCoordinationTools } from './coordination-tools';

function makeConfig(id: string, role: 'manager' | 'lead' | 'specialist' | 'none'): AgentConfig {
  return {
    id,
    version: 2,
    name: id,
    description: '',
    tags: [],
    provider: { pluginId: 'openrouter', authMethodId: 'api-key', envVar: 'OPENROUTER_API_KEY', baseUrl: '' },
    modelId: 'openai/gpt-4o',
    thinkingLevel: 'off',
    systemPrompt: { mode: 'append', sections: [], assembled: '', userInstructions: '' },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: {
      tokenBudget: 128000,
      reservedForResponse: 4096,
      compactionStrategy: 'summary',
      compactionTrigger: 'auto',
      compactionThreshold: 0.8,
      autoFlushBeforeCompact: true,
      ragEnabled: false,
      ragTopK: 5,
      ragMinScore: 0.7,
    },
    agentComm: [],
    storage: {
      label: 'Storage',
      backendType: 'filesystem',
      storagePath: '~/.simple-agent-manager/storage',
      sessionRetention: 50,
      memoryEnabled: true,
      dailyMemoryEnabled: true,
      dailyResetEnabled: false,
      dailyResetHour: 4,
      idleResetEnabled: false,
      idleResetMinutes: 60,
      parentForkMaxTokens: 100000,
      maintenanceMode: 'warn',
      pruneAfterDays: 30,
      maxEntries: 500,
      rotateBytes: 10485760,
      resetArchiveRetentionDays: 30,
      maxDiskBytes: 0,
      highWaterPercent: 80,
      maintenanceIntervalMinutes: 60,
    },
    vectorDatabases: [],
    crons: [],
    mcps: [],
    subAgents: [],
    coordination: { role, capabilities: [], maxConcurrentTasks: 1 },
    workspacePath: null,
    exportedAt: Date.now(),
    sourceGraphId: 'test',
    runTimeoutMs: 60000,
  };
}

class FakeGateway implements AgentDispatchGateway {
  started: string[] = [];
  aborted: string[] = [];
  listeners = new Map<string, RunEventListener>();
  dispatchCount = 0;
  managedConfigs: AgentConfig[] = [];

  listManagedAgentConfigs(): AgentConfig[] {
    return this.managedConfigs;
  }

  async ensureAgentStarted(config: AgentConfig): Promise<void> {
    this.started.push(config.id);
  }

  async dispatch(agentId: string): Promise<{ runId: string; sessionId: string; acceptedAt: number }> {
    this.dispatchCount += 1;
    return { runId: `run_${this.dispatchCount}`, sessionId: `session_${agentId}`, acceptedAt: Date.now() };
  }

  subscribe(_agentId: string, runId: string, listener: RunEventListener): () => void {
    this.listeners.set(runId, listener);
    return () => this.listeners.delete(runId);
  }

  abortRun(_agentId: string, runId: string): void {
    this.aborted.push(runId);
  }

  emit(runId: string, event: CoordinatorEvent): void {
    this.listeners.get(runId)?.(event);
  }
}

describe('CoordinationService', () => {
  let tmpDir: string;
  let store: CoordinationStore;
  let service: CoordinationService;
  let gateway: FakeGateway;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-coordination-service-'));
    store = new CoordinationStore(path.join(tmpDir, 'coordination.db'));
    service = new CoordinationService(store);
    gateway = new FakeGateway();
    service.setGateway(gateway);
    service.syncAgents({
      agents: [
        { config: makeConfig('manager', 'manager') },
        { config: makeConfig('lead', 'lead') },
        { config: makeConfig('specialist', 'specialist') },
      ],
    });
  });

  afterEach(() => {
    service.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('dispatches assigned tasks and completes the workflow from run events', async () => {
    const workflow = service.createWorkflow('manager', {
      title: 'Build feature',
      objective: 'Ship it',
    });
    service.startWorkflow('manager', workflow.id);
    const task = service.assignTask('manager', {
      workflowId: workflow.id,
      title: 'Implement',
      description: 'Implement the feature',
      assignedAgentId: 'lead',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gateway.started).toContain('lead');
    let detail = service.getWorkflowDetail(workflow.id);
    expect(detail?.tasks[0].status).toBe('running');

    gateway.emit('run_1', {
      type: 'lifecycle:start',
      runId: 'run_1',
      agentId: 'lead',
      sessionId: 'session_lead',
      startedAt: Date.now(),
    });
    gateway.emit('run_1', {
      type: 'lifecycle:end',
      runId: 'run_1',
      status: 'ok',
      startedAt: Date.now() - 10,
      endedAt: Date.now(),
      payloads: [{ type: 'text', content: 'Done' }],
    });

    detail = service.getWorkflowDetail(workflow.id);
    expect(detail?.tasks.find((t) => t.id === task.id)?.status).toBe('completed');
    expect(detail?.workflow.status).toBe('completed');
    expect(service.getTrace(workflow.id).map((event) => event.type)).toContain('run_completed');
  });

  it('transitions the workflow to failed when a task fails instead of hanging in running', async () => {
    const workflow = service.createWorkflow('manager', {
      title: 'Will fail',
      objective: 'Exercise failure path',
    });
    service.startWorkflow('manager', workflow.id);
    const task = service.assignTask('manager', {
      workflowId: workflow.id,
      title: 'Doomed task',
      description: 'This run errors out',
      assignedAgentId: 'lead',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.getWorkflowDetail(workflow.id)?.tasks[0].status).toBe('running');

    gateway.emit('run_1', {
      type: 'lifecycle:start',
      runId: 'run_1',
      agentId: 'lead',
      sessionId: 'session_lead',
      startedAt: Date.now(),
    });
    gateway.emit('run_1', {
      type: 'lifecycle:error',
      runId: 'run_1',
      status: 'error',
      startedAt: Date.now() - 10,
      endedAt: Date.now(),
      error: { code: 'aborted', message: 'budget abort', retriable: false },
    });

    const detail = service.getWorkflowDetail(workflow.id);
    expect(detail?.tasks.find((t) => t.id === task.id)?.status).toBe('failed');
    expect(detail?.workflow.status).toBe('failed');
  });

  it('lazily syncs currently managed gateway agents before lifecycle checks', async () => {
    gateway.managedConfigs = [
      makeConfig('late-manager', 'manager'),
      makeConfig('late-lead', 'lead'),
    ];

    const workflow = service.createWorkflow('late-manager', {
      title: 'Late sync',
      objective: 'Use managed configs',
    });
    service.startWorkflow('late-manager', workflow.id);
    service.assignTask('late-manager', {
      workflowId: workflow.id,
      title: 'Assigned after lazy sync',
      description: 'Should dispatch',
      assignedAgentId: 'late-lead',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gateway.started).toContain('late-lead');
  });

  it('aborts active assigned runs and writes a stop report', async () => {
    const workflow = service.createWorkflow('manager', {
      title: 'Stop me',
      objective: 'Exercise stop',
    });
    service.startWorkflow('manager', workflow.id);
    service.assignTask('manager', {
      workflowId: workflow.id,
      title: 'Active task',
      description: 'Run forever',
      assignedAgentId: 'lead',
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gateway.listeners.has('run_1')).toBe(true);

    const report = service.stopWorkflow('manager', workflow.id, 'No longer needed');
    expect(gateway.aborted).toContain('run_1');
    expect(report.type).toBe('stop_report');
    expect(service.getWorkflowDetail(workflow.id)?.workflow.status).toBe('stopped_by_user');
    expect(service.getWorkflowDetail(workflow.id)?.tasks[0].status).toBe('cancelled');
  });

  it('limits tool authority by role', async () => {
    expect(() =>
      service.createWorkflow('specialist', { title: 'Nope', objective: 'No authority' }),
    ).toThrow(/manager authority/);

    const specialistTools = createCoordinationTools({
      service,
      callerAgentId: 'specialist',
      callerRunId: 'run',
      callerSessionKey: 'agent:specialist:main',
      config: makeConfig('specialist', 'specialist'),
    });
    expect(specialistTools.map((tool) => tool.name)).toEqual([
      'coordination_task_update',
      'coordination_task_blocked',
      'coordination_task_complete',
    ]);
  });
});
