import { describe, expect, it, vi, afterEach } from 'vitest';
import { CronScheduler } from './cron-scheduler';
import type { ResolvedCronConfig } from '../../shared/agent-config';
import type { RunCoordinator } from '../agents/run-coordinator';

// Mock node-cron to avoid real timers that can bleed into other test files
vi.mock('node-cron', () => {
  return {
    schedule: vi.fn(() => ({
      stop: vi.fn(),
    })),
  };
});

function makeCronConfig(overrides?: Partial<ResolvedCronConfig>): ResolvedCronConfig {
  return {
    cronNodeId: 'cron-1',
    label: 'Test Cron',
    schedule: '* * * * *',
    prompt: 'Do the thing',
    enabled: true,
    sessionMode: 'persistent',
    timezone: 'local',
    maxRunDurationMs: 300000,
    retentionDays: 7,
    ...overrides,
  };
}

function makeMockCoordinator(): RunCoordinator {
  return {
    dispatch: vi.fn().mockResolvedValue({ runId: 'run-1', sessionId: 'sess-1', acceptedAt: Date.now() }),
    abort: vi.fn(),
  } as unknown as RunCoordinator;
}

describe('CronScheduler', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reconcile starts enabled jobs and stops removed ones', () => {
    const coordinator = makeMockCoordinator();
    const scheduler = new CronScheduler((id) => id === 'a1' ? coordinator : null);

    scheduler.reconcile('a1', [makeCronConfig()]);
    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].cronNodeId).toBe('cron-1');
    expect(jobs[0].status).toBe('scheduled');

    // Remove the job
    scheduler.reconcile('a1', []);
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  it('reconcile skips disabled jobs', () => {
    const coordinator = makeMockCoordinator();
    const scheduler = new CronScheduler(() => coordinator);

    scheduler.reconcile('a1', [makeCronConfig({ enabled: false })]);
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  it('stopAll clears all jobs', () => {
    const coordinator = makeMockCoordinator();
    const scheduler = new CronScheduler(() => coordinator);

    scheduler.reconcile('a1', [makeCronConfig()]);
    scheduler.reconcile('a2', [makeCronConfig({ cronNodeId: 'cron-2' })]);
    expect(scheduler.listJobs()).toHaveLength(2);

    scheduler.stopAll();
    expect(scheduler.listJobs()).toHaveLength(0);
  });
});
