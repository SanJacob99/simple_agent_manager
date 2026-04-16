import * as cron from 'node-cron';
import type { ResolvedCronConfig } from '../../shared/agent-config';
import type { RunCoordinator } from '../agents/run-coordinator';

export interface CronJobStatus {
  cronNodeId: string;
  agentId: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  status: 'scheduled' | 'running' | 'stopped';
}

interface ActiveJob {
  cronNodeId: string;
  agentId: string;
  config: ResolvedCronConfig;
  task: cron.ScheduledTask;
  lastRunAt?: string;
}

export class CronScheduler {
  private readonly jobs = new Map<string, ActiveJob>();

  constructor(
    private readonly coordinatorLookup: (agentId: string) => RunCoordinator | null,
  ) {}

  reconcile(agentId: string, crons: ResolvedCronConfig[]): void {
    const desiredIds = new Set(crons.filter((c) => c.enabled).map((c) => c.cronNodeId));

    // Stop removed or disabled jobs for this agent
    for (const [key, job] of this.jobs) {
      if (job.agentId === agentId && !desiredIds.has(job.cronNodeId)) {
        job.task.stop();
        this.jobs.delete(key);
      }
    }

    // Start or update jobs
    for (const config of crons) {
      if (!config.enabled) continue;

      const key = `${agentId}:${config.cronNodeId}`;
      const existing = this.jobs.get(key);

      if (existing && existing.config.schedule === config.schedule && existing.config.prompt === config.prompt) {
        existing.config = config;
        continue;
      }

      // Stop old if schedule changed
      if (existing) {
        existing.task.stop();
      }

      const task = cron.schedule(config.schedule, () => {
        void this.executeCronTick(agentId, config, key);
      }, {
        timezone: config.timezone === 'local' ? undefined : config.timezone,
      });

      this.jobs.set(key, {
        cronNodeId: config.cronNodeId,
        agentId,
        config,
        task,
      });
    }
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      job.task.stop();
    }
    this.jobs.clear();
  }

  listJobs(): CronJobStatus[] {
    return [...this.jobs.values()].map((job) => ({
      cronNodeId: job.cronNodeId,
      agentId: job.agentId,
      schedule: job.config.schedule,
      enabled: job.config.enabled,
      lastRunAt: job.lastRunAt,
      status: 'scheduled' as const,
    }));
  }

  private async executeCronTick(agentId: string, config: ResolvedCronConfig, jobKey: string): Promise<void> {
    const coordinator = this.coordinatorLookup(agentId);
    if (!coordinator) {
      console.error(`[CronScheduler] No coordinator for agent ${agentId}`);
      return;
    }

    try {
      const dispatched = await coordinator.dispatch({
        sessionKey: `cron:${config.cronNodeId}`,
        text: config.prompt,
      });

      const job = this.jobs.get(jobKey);
      if (job) {
        job.lastRunAt = new Date().toISOString();
      }

      // Enforce max run duration
      if (config.maxRunDurationMs > 0) {
        setTimeout(() => {
          coordinator.abort(dispatched.runId);
        }, config.maxRunDurationMs);
      }
    } catch (err) {
      console.error(`[CronScheduler] Cron tick failed for ${config.cronNodeId}:`, err);
    }
  }
}
