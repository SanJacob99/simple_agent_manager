import type { StorageEngine } from './storage-engine';
import type { MaintenanceReport } from '../../shared/storage-types';

export class MaintenanceScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly engine: StorageEngine,
    private readonly intervalMinutes: number,
  ) {}

  start(): void {
    this.stop();
    void this.engine.runMaintenance().catch((err) => {
      console.error('[MaintenanceScheduler] startup run failed:', err);
    });

    this.timer = setInterval(() => {
      void this.engine.runMaintenance().catch((err) => {
        console.error('[MaintenanceScheduler] scheduled run failed:', err);
      });
    }, this.intervalMinutes * 60 * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runNow(mode?: 'warn' | 'enforce'): Promise<MaintenanceReport> {
    return this.engine.runMaintenance(mode);
  }
}
