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

export class SubAgentRegistry {
  private readonly records = new Map<string, SubAgentRecord>();
  private readonly byRunId = new Map<string, string>();
  private readonly yieldPending = new Set<string>();

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
    const subAgentId = this.byRunId.get(runId);
    if (!subAgentId) return;
    const record = this.records.get(subAgentId);
    if (!record || record.status !== 'running') return;
    record.status = 'completed';
    record.result = result;
    record.endedAt = Date.now();
  }

  onError(runId: string, error: string): void {
    const subAgentId = this.byRunId.get(runId);
    if (!subAgentId) return;
    const record = this.records.get(subAgentId);
    if (!record || record.status !== 'running') return;
    record.status = 'error';
    record.error = error;
    record.endedAt = Date.now();
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
    return true;
  }

  allComplete(parentSessionKey: string): boolean {
    const children = this.listForParent(parentSessionKey);
    return children.length > 0 && children.every((r) => r.status !== 'running');
  }

  setYieldPending(parentSessionKey: string): void {
    this.yieldPending.add(parentSessionKey);
  }

  isYieldPending(parentSessionKey: string): boolean {
    return this.yieldPending.has(parentSessionKey);
  }

  clearYieldPending(parentSessionKey: string): void {
    this.yieldPending.delete(parentSessionKey);
  }
}
