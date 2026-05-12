import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CoordinationStore } from './coordination-store';
import type { AgentConfig } from '../../shared/agent-config';

function makeConfig(id: string, role: 'manager' | 'lead' | 'specialist'): AgentConfig {
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

describe('CoordinationStore', () => {
  let tmpDir: string;
  let store: CoordinationStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sam-coordination-'));
    store = new CoordinationStore(path.join(tmpDir, 'coordination.db'));
  });

  afterEach(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists synced agents, workflows, tasks, events, and reports', () => {
    const agents = store.syncAgents([
      {
        agentId: 'manager',
        name: 'Manager',
        role: 'manager',
        capabilities: ['planning'],
        maxConcurrentTasks: 1,
        config: makeConfig('manager', 'manager'),
        configHash: 'hash',
        available: true,
        unavailableReasons: [],
        updatedAt: new Date().toISOString(),
      },
    ]);
    expect(agents[0].role).toBe('manager');

    const workflow = store.createWorkflow(
      'wf_1',
      { title: 'Build', objective: 'Ship v1', successCriteria: ['done'] },
      'manager',
    );
    const task = store.createTask('task_1', {
      workflowId: workflow.id,
      title: 'Draft',
      description: 'Draft the thing',
      assignedAgentId: 'manager',
    });
    store.appendEvent({
      id: 'evt_1',
      workflowId: workflow.id,
      taskId: task.id,
      agentId: 'manager',
      type: 'task_assigned',
      payload: { ok: true },
      timestamp: new Date().toISOString(),
    });
    const report = store.createReport({
      id: 'report_1',
      workflowId: workflow.id,
      agentId: 'manager',
      type: 'manager_rollup',
      status: 'draft',
      summary: { hello: 'world' },
      createdAt: new Date().toISOString(),
    });

    const detail = store.getWorkflowDetail(workflow.id);
    expect(detail?.tasks).toHaveLength(1);
    expect(detail?.taskCounts.pending).toBe(1);
    expect(store.listEvents(workflow.id)).toHaveLength(1);
    expect(store.latestReport(workflow.id)?.id).toBe(report.id);
  });
});

