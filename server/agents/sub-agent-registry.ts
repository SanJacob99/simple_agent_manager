import { randomUUID } from 'crypto';

export interface SubAgentRecord {
  subAgentId: string;
  parentSessionKey: string;
  parentRunId: string;
  targetAgentId: string;
  sessionKey: string;
  runId: string;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  endedAt?: number;
  result?: string;
  error?: string;
}

export interface ResumeResult {
  subAgentId: string;
  targetAgentId: string;
  sessionKey: string;
  status: 'completed' | 'error' | 'running';
  startedAt: number;
  endedAt?: number;
  durationMs: number;
  text?: string;
  error?: string;
}

export interface ResumePayload {
  parentSessionKey: string;
  parentAgentId: string;
  parentRunId: string;
  results: ResumeResult[];
  reason: 'all-complete' | 'timeout';
}

export interface SetYieldOpts {
  parentAgentId: string;
  parentRunId: string;
  timeoutMs: number;
}

export type SetYieldResult =
  | { setupOk: true }
  | { setupOk: false; reason: 'no-active-subs' | 'already-pending' };

interface YieldState {
  parentSessionKey: string;
  parentAgentId: string;
  parentRunId: string;
  startedAt: number;
  timeoutMs: number;
  timeoutTimer: ReturnType<typeof setTimeout>;
  resolve: (payload: ResumePayload) => void;
  resolved: boolean;
}

export class SubAgentRegistry {
  private readonly records = new Map<string, SubAgentRecord>();
  private readonly byRunId = new Map<string, string>();
  private readonly yields = new Map<string, YieldState>();

  spawn(
    parent: { sessionKey: string; runId: string },
    target: { agentId: string; sessionKey: string; runId: string },
  ): SubAgentRecord {
    const subAgentId = randomUUID();
    const record: SubAgentRecord = {
      subAgentId,
      parentSessionKey: parent.sessionKey,
      parentRunId: parent.runId,
      targetAgentId: target.agentId,
      sessionKey: target.sessionKey,
      runId: target.runId,
      status: 'running',
      startedAt: Date.now(),
    };
    this.records.set(subAgentId, record);
    this.byRunId.set(target.runId, subAgentId);
    return record;
  }

  onComplete(runId: string, result: string): void {
    const record = this.recordForRunId(runId);
    if (!record || record.status !== 'running') return;
    record.status = 'completed';
    record.result = result;
    record.endedAt = Date.now();
    this.maybeResolveYield(record.parentSessionKey);
  }

  onError(runId: string, error: string): void {
    const record = this.recordForRunId(runId);
    if (!record || record.status !== 'running') return;
    record.status = 'error';
    record.error = error;
    record.endedAt = Date.now();
    this.maybeResolveYield(record.parentSessionKey);
  }

  listForParent(parentSessionKey: string): SubAgentRecord[] {
    return [...this.records.values()].filter(
      (r) => r.parentSessionKey === parentSessionKey,
    );
  }

  get(subAgentId: string): SubAgentRecord | null {
    return this.records.get(subAgentId) ?? null;
  }

  kill(subAgentId: string): boolean {
    const record = this.records.get(subAgentId);
    if (!record || record.status !== 'running') return false;
    record.status = 'error';
    record.error = 'Killed by parent';
    record.endedAt = Date.now();
    this.maybeResolveYield(record.parentSessionKey);
    return true;
  }

  allComplete(parentSessionKey: string): boolean {
    const children = this.listForParent(parentSessionKey);
    return children.length > 0 && children.every((r) => r.status !== 'running');
  }

  setYieldPending(
    parentSessionKey: string,
    opts: SetYieldOpts,
    resolve: (payload: ResumePayload) => void,
  ): SetYieldResult {
    if (this.yields.has(parentSessionKey)) {
      return { setupOk: false, reason: 'already-pending' };
    }

    const running = this.listForParent(parentSessionKey).filter((r) => r.status === 'running');
    if (running.length === 0) {
      return { setupOk: false, reason: 'no-active-subs' };
    }

    const state: YieldState = {
      parentSessionKey,
      parentAgentId: opts.parentAgentId,
      parentRunId: opts.parentRunId,
      startedAt: Date.now(),
      timeoutMs: opts.timeoutMs,
      timeoutTimer: setTimeout(() => this.resolveOnTimeout(parentSessionKey), opts.timeoutMs),
      resolve,
      resolved: false,
    };
    this.yields.set(parentSessionKey, state);
    return { setupOk: true };
  }

  cancelYield(parentSessionKey: string): void {
    const state = this.yields.get(parentSessionKey);
    if (!state) return;
    clearTimeout(state.timeoutTimer);
    state.resolved = true;
    this.yields.delete(parentSessionKey);
  }

  /**
   * Cancel every outstanding yield. Used by RunCoordinator.destroy()
   * because the run-records map evicts completed runs after RUN_RECORD_TTL_MS
   * (5 min) but yield timers default to 10 min, so iterating runs alone
   * would miss yields whose parent runs were already cleaned up.
   */
  cancelAllYields(): void {
    for (const parentSessionKey of [...this.yields.keys()]) {
      this.cancelYield(parentSessionKey);
    }
  }

  isYieldPending(parentSessionKey: string): boolean {
    return this.yields.has(parentSessionKey);
  }

  private recordForRunId(runId: string): SubAgentRecord | undefined {
    const subAgentId = this.byRunId.get(runId);
    if (!subAgentId) return undefined;
    return this.records.get(subAgentId);
  }

  private maybeResolveYield(parentSessionKey: string): void {
    const state = this.yields.get(parentSessionKey);
    if (!state || state.resolved) return;

    const stillRunning = this.listForParent(parentSessionKey).some((r) => r.status === 'running');
    if (stillRunning) return;

    this.finishYield(state, 'all-complete');
  }

  private resolveOnTimeout(parentSessionKey: string): void {
    const state = this.yields.get(parentSessionKey);
    if (!state || state.resolved) return;
    this.finishYield(state, 'timeout');
  }

  private finishYield(state: YieldState, reason: 'all-complete' | 'timeout'): void {
    state.resolved = true;
    clearTimeout(state.timeoutTimer);
    this.yields.delete(state.parentSessionKey);

    const results: ResumeResult[] = this.listForParent(state.parentSessionKey).map((r) => ({
      subAgentId: r.subAgentId,
      targetAgentId: r.targetAgentId,
      sessionKey: r.sessionKey,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationMs: (r.endedAt ?? Date.now()) - r.startedAt,
      text: r.result,
      error: r.error,
    }));

    state.resolve({
      parentSessionKey: state.parentSessionKey,
      parentAgentId: state.parentAgentId,
      parentRunId: state.parentRunId,
      results,
      reason,
    });
  }
}
