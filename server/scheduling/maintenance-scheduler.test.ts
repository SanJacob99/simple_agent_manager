import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { MaintenanceScheduler } from './maintenance-scheduler';
import type { StorageEngine } from '../storage/storage-engine';
import type { MaintenanceReport } from '../../shared/storage-types';

function makeMockEngine(): StorageEngine {
  const mockReport: MaintenanceReport = {
    mode: 'warn',
    prunedEntries: [],
    orphanTranscripts: [],
    archivedResets: [],
    storeRotated: false,
    diskBefore: 0,
    diskAfter: 0,
    evictedForBudget: [],
  };

  return {
    runMaintenance: vi.fn().mockResolvedValue(mockReport),
  } as unknown as StorageEngine;
}

describe('MaintenanceScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs maintenance on start', async () => {
    const engine = makeMockEngine();
    const scheduler = new MaintenanceScheduler(engine, 60);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.runMaintenance).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('runs maintenance on interval', async () => {
    const engine = makeMockEngine();
    const scheduler = new MaintenanceScheduler(engine, 1);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(engine.runMaintenance).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it('runNow triggers on-demand maintenance', async () => {
    const engine = makeMockEngine();
    const scheduler = new MaintenanceScheduler(engine, 60);
    const report = await scheduler.runNow();
    expect(report.mode).toBe('warn');
    expect(engine.runMaintenance).toHaveBeenCalledTimes(1);
  });

  it('stop clears the interval', async () => {
    const engine = makeMockEngine();
    const scheduler = new MaintenanceScheduler(engine, 1);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(engine.runMaintenance).toHaveBeenCalledTimes(1);
  });
});
