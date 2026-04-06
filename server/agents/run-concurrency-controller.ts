export interface QueueSnapshot {
  sessionPosition: number;
  globalPosition: number;
}

export interface DrainDecision {
  runId: string;
  sessionId: string;
}

export interface QueueMutationResult {
  affectedRunIds: string[];
}

export interface EnqueueResult extends QueueMutationResult {
  snapshot: QueueSnapshot;
}

export interface AbortPendingResult extends QueueMutationResult {
  removed: boolean;
  sessionId?: string;
}

export class RunConcurrencyController {
  private readonly sessionQueues = new Map<string, string[]>();
  private readonly globalQueue: string[] = [];
  private readonly runToSession = new Map<string, string>();
  private activeRunId: string | null = null;
  private leasedSessionId: string | null = null;

  enqueue(runId: string, sessionId: string): EnqueueResult {
    const before = this.collectSnapshots();

    let sessionQueue = this.sessionQueues.get(sessionId);
    if (!sessionQueue) {
      sessionQueue = [];
      this.sessionQueues.set(sessionId, sessionQueue);
    }

    sessionQueue.push(runId);
    this.globalQueue.push(runId);
    this.runToSession.set(runId, sessionId);

    const after = this.collectSnapshots();
    const snapshot = after.get(runId);
    if (!snapshot) {
      throw new Error(`Failed to snapshot queued run ${runId}`);
    }

    return {
      snapshot,
      affectedRunIds: this.diffSnapshots(before, after, new Set([runId])),
    };
  }

  getSnapshot(runId: string): QueueSnapshot | null {
    return this.collectSnapshots().get(runId) ?? null;
  }

  drain(): DrainDecision | null {
    if (this.activeRunId) {
      return null;
    }

    for (const runId of this.globalQueue) {
      const sessionId = this.runToSession.get(runId);
      if (!sessionId) continue;

      const sessionQueue = this.sessionQueues.get(sessionId);
      if (sessionQueue?.[0] === runId) {
        return { runId, sessionId };
      }
    }

    return null;
  }

  start(runId: string, sessionId: string): QueueMutationResult {
    if (this.activeRunId) {
      throw new Error(`Cannot start ${runId}; ${this.activeRunId} is already active`);
    }

    const sessionQueue = this.sessionQueues.get(sessionId);
    if (!sessionQueue || sessionQueue[0] !== runId) {
      throw new Error(`Cannot start ${runId}; it is not the head of session ${sessionId}`);
    }

    const before = this.collectSnapshots();

    sessionQueue.shift();
    if (sessionQueue.length === 0) {
      this.sessionQueues.delete(sessionId);
    }

    this.removeFromGlobalQueue(runId);
    this.activeRunId = runId;
    this.leasedSessionId = sessionId;

    const after = this.collectSnapshots();
    return {
      affectedRunIds: this.diffSnapshots(before, after, new Set([runId])),
    };
  }

  abortPending(runId: string): AbortPendingResult {
    if (this.activeRunId === runId) {
      return { removed: false, affectedRunIds: [] };
    }

    const sessionId = this.runToSession.get(runId);
    if (!sessionId || !this.globalQueue.includes(runId)) {
      return { removed: false, affectedRunIds: [] };
    }

    const before = this.collectSnapshots();
    this.removeFromSessionQueue(runId, sessionId);
    this.removeFromGlobalQueue(runId);
    this.runToSession.delete(runId);

    const after = this.collectSnapshots();
    return {
      removed: true,
      sessionId,
      affectedRunIds: this.diffSnapshots(before, after, new Set([runId])),
    };
  }

  release(runId: string, sessionId: string): QueueMutationResult {
    if (this.activeRunId !== runId || this.leasedSessionId !== sessionId) {
      return { affectedRunIds: [] };
    }

    this.activeRunId = null;
    this.leasedSessionId = null;
    this.runToSession.delete(runId);

    return { affectedRunIds: [] };
  }

  destroy(): string[] {
    const pendingRunIds = [...this.globalQueue];

    this.sessionQueues.clear();
    this.globalQueue.length = 0;
    this.runToSession.clear();
    this.activeRunId = null;
    this.leasedSessionId = null;

    return pendingRunIds;
  }

  private collectSnapshots(): Map<string, QueueSnapshot> {
    const snapshots = new Map<string, QueueSnapshot>();

    for (let globalIndex = 0; globalIndex < this.globalQueue.length; globalIndex++) {
      const runId = this.globalQueue[globalIndex];
      const sessionId = this.runToSession.get(runId);
      if (!sessionId) continue;

      const sessionQueue = this.sessionQueues.get(sessionId);
      if (!sessionQueue) continue;

      const sessionIndex = sessionQueue.indexOf(runId);
      if (sessionIndex === -1) continue;

      snapshots.set(runId, {
        sessionPosition: sessionIndex + 1,
        globalPosition: globalIndex + 1,
      });
    }

    return snapshots;
  }

  private diffSnapshots(
    before: Map<string, QueueSnapshot>,
    after: Map<string, QueueSnapshot>,
    exclude: Set<string>,
  ): string[] {
    const candidates = new Set<string>([
      ...before.keys(),
      ...after.keys(),
    ]);

    const changed: string[] = [];
    for (const runId of candidates) {
      if (exclude.has(runId)) continue;

      const previous = before.get(runId);
      const next = after.get(runId);
      if (!this.sameSnapshot(previous, next)) {
        changed.push(runId);
      }
    }

    return changed;
  }

  private sameSnapshot(
    left: QueueSnapshot | undefined,
    right: QueueSnapshot | undefined,
  ): boolean {
    if (!left && !right) return true;
    if (!left || !right) return false;
    return (
      left.sessionPosition === right.sessionPosition &&
      left.globalPosition === right.globalPosition
    );
  }

  private removeFromSessionQueue(runId: string, sessionId: string): void {
    const sessionQueue = this.sessionQueues.get(sessionId);
    if (!sessionQueue) return;

    const index = sessionQueue.indexOf(runId);
    if (index === -1) return;

    sessionQueue.splice(index, 1);
    if (sessionQueue.length === 0) {
      this.sessionQueues.delete(sessionId);
    }
  }

  private removeFromGlobalQueue(runId: string): void {
    const index = this.globalQueue.indexOf(runId);
    if (index !== -1) {
      this.globalQueue.splice(index, 1);
    }
  }
}
