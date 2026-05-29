/**
 * Registry of pending Human-in-the-Loop prompts.
 *
 * The `ask_user` tool registers an entry when it starts awaiting input.
 * The WebSocket handler resolves entries when it receives a `hitl:respond`
 * command, or when a user message arrives while a prompt is pending (the
 * dispatch path intercepts it and calls `resolve()` instead of starting a
 * new turn).
 *
 * Entries live in-memory and survive client disconnect; server restart drops
 * them, which is acceptable — the tool will time out on the pending agent.
 */

import { logError } from '../logger';

export type HitlKind = 'text' | 'confirm';

export type HitlAnswer =
  | { kind: 'text'; answer: string }
  | { kind: 'confirm'; answer: 'yes' | 'no' }
  | { cancelled: true; reason: 'timeout' | 'aborted' };

export interface PendingHitlSnapshot {
  agentId: string;
  sessionKey: string;
  toolCallId: string;
  toolName: string;
  kind: HitlKind;
  question: string;
  createdAt: number;
  timeoutMs: number;
}

interface PendingEntry extends PendingHitlSnapshot {
  resolve: (answer: HitlAnswer) => void;
  timer: ReturnType<typeof setTimeout>;
  // Monotonic insertion sequence. `createdAt` alone is not a reliable FIFO
  // key because two prompts registered in the same millisecond would tie;
  // `seq` breaks such ties deterministically in registration order.
  seq: number;
}

export interface RegisterParams {
  agentId: string;
  sessionKey: string;
  toolCallId: string;
  toolName: string;
  kind: HitlKind;
  question: string;
  timeoutMs: number;
  onResolved?: (answer: HitlAnswer) => void;
}

function keyOf(agentId: string, sessionKey: string, toolCallId: string): string {
  return `${agentId}::${sessionKey}::${toolCallId}`;
}

export class HitlRegistry {
  private readonly pending = new Map<string, PendingEntry>();
  private seqCounter = 0;

  /**
   * Register a new pending prompt. Returns a Promise that resolves when
   * `resolve()` is called, the timeout fires, or the entry is cancelled.
   */
  register(params: RegisterParams): Promise<HitlAnswer> {
    return new Promise<HitlAnswer>((resolve) => {
      const key = keyOf(params.agentId, params.sessionKey, params.toolCallId);

      // If something is already registered under this key, clear it first
      // (shouldn't happen in practice — toolCallIds are unique per run).
      const existing = this.pending.get(key);
      if (existing) {
        clearTimeout(existing.timer);
        existing.resolve({ cancelled: true, reason: 'aborted' });
      }

      const finalize = (answer: HitlAnswer) => {
        const still = this.pending.get(key);
        if (!still) return;
        clearTimeout(still.timer);
        this.pending.delete(key);
        resolve(answer);
        params.onResolved?.(answer);
      };

      const entry: PendingEntry = {
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        toolCallId: params.toolCallId,
        toolName: params.toolName,
        kind: params.kind,
        question: params.question,
        timeoutMs: params.timeoutMs,
        createdAt: Date.now(),
        seq: this.seqCounter++,
        timer: setTimeout(() => finalize({ cancelled: true, reason: 'timeout' }), params.timeoutMs),
        resolve: finalize,
      };

      this.pending.set(key, entry);
    });
  }

  /**
   * Resolve a pending entry with the given answer. Returns true when an
   * entry existed and was resolved, false otherwise.
   */
  resolve(
    agentId: string,
    sessionKey: string,
    toolCallId: string,
    answer: HitlAnswer,
  ): boolean {
    const key = keyOf(agentId, sessionKey, toolCallId);
    const entry = this.pending.get(key);
    if (!entry) return false;
    entry.resolve(answer);
    return true;
  }

  /**
   * Resolve a prompt that is currently pending for the session. Used by the
   * dispatch path when a user message arrives and we need to route it to the
   * HITL resolver instead of starting a new turn, and by the REST `respond`
   * endpoint for headless control.
   *
   * Disambiguation when multiple prompts are pending for the same session:
   *   1. If `toolCallId` is supplied, resolve exactly that prompt (deterministic
   *      targeting). If no pending prompt matches that id, returns null.
   *   2. If `toolCallId` is omitted, resolve the OLDEST pending prompt
   *      (FIFO by createdAt, then registration `seq` to break same-ms ties)
   *      rather than an arbitrary Map-iteration match. FIFO is the safe default
   *      because the earliest prompt is the one the agent has been blocked on
   *      the longest.
   *
   * Returns the matched entry's snapshot so callers can persist the answer
   * with the correct toolCallId/kind. Returns null when nothing matches.
   *
   * If the resolved prompt is `kind: 'confirm'` and the raw text does not
   * parse to exactly yes/no (see `parseConfirm`), the entry is NOT resolved
   * and a `parseError` is returned so the caller can tell the user to try
   * again.
   */
  resolveForSession(
    agentId: string,
    sessionKey: string,
    rawText: string,
    toolCallId?: string,
  ): { resolved: PendingHitlSnapshot; kind: HitlKind; normalized: string } | { parseError: string } | null {
    const entry = this.selectForSession(agentId, sessionKey, toolCallId);
    if (!entry) return null;

    if (entry.kind === 'confirm') {
      const parsed = parseConfirm(rawText);
      if (!parsed) {
        return { parseError: 'Please reply exactly "yes" or "no".' };
      }
      entry.resolve({ kind: 'confirm', answer: parsed });
      return { resolved: snapshotOf(entry), kind: 'confirm', normalized: parsed };
    }

    entry.resolve({ kind: 'text', answer: rawText });
    return { resolved: snapshotOf(entry), kind: 'text', normalized: rawText };
  }

  /**
   * Cancel a single pending prompt for a session. When `toolCallId` is given,
   * targets that exact prompt; otherwise cancels the OLDEST pending prompt
   * (FIFO), mirroring `resolveForSession`'s disambiguation. Returns the
   * cancelled prompt's snapshot, or null when nothing matched.
   */
  cancelForSession(
    agentId: string,
    sessionKey: string,
    reason: 'aborted' | 'timeout',
    toolCallId?: string,
  ): PendingHitlSnapshot | null {
    const entry = this.selectForSession(agentId, sessionKey, toolCallId);
    if (!entry) return null;
    const snapshot = snapshotOf(entry);
    entry.resolve({ cancelled: true, reason });
    return snapshot;
  }

  /**
   * Pick the pending entry for a session to act on. With `toolCallId`, returns
   * that exact entry (or null). Without it, returns the oldest pending entry
   * for the session by (createdAt, seq) FIFO order, or null when none pending.
   */
  private selectForSession(
    agentId: string,
    sessionKey: string,
    toolCallId?: string,
  ): PendingEntry | null {
    if (toolCallId) {
      const entry = this.pending.get(keyOf(agentId, sessionKey, toolCallId));
      return entry ?? null;
    }
    let oldest: PendingEntry | null = null;
    for (const entry of this.pending.values()) {
      if (entry.agentId !== agentId || entry.sessionKey !== sessionKey) continue;
      if (
        oldest === null ||
        entry.createdAt < oldest.createdAt ||
        (entry.createdAt === oldest.createdAt && entry.seq < oldest.seq)
      ) {
        oldest = entry;
      }
    }
    return oldest;
  }

  /**
   * Cancel every pending prompt for a session. Used by abort.
   */
  cancelAllForSession(
    agentId: string,
    sessionKey: string,
    reason: 'aborted' | 'timeout',
  ): PendingHitlSnapshot[] {
    const cancelled: PendingHitlSnapshot[] = [];
    for (const entry of Array.from(this.pending.values())) {
      if (entry.agentId !== agentId || entry.sessionKey !== sessionKey) continue;
      try {
        entry.resolve({ cancelled: true, reason });
        cancelled.push(snapshotOf(entry));
      } catch (err) {
        logError('hitl', `failed to cancel entry ${entry.toolCallId}: ${(err as Error).message}`);
      }
    }
    return cancelled;
  }

  /** Snapshot of every pending prompt for a session (for reconnect). */
  listForSession(agentId: string, sessionKey: string): PendingHitlSnapshot[] {
    const list: PendingHitlSnapshot[] = [];
    for (const entry of this.pending.values()) {
      if (entry.agentId === agentId && entry.sessionKey === sessionKey) {
        list.push(snapshotOf(entry));
      }
    }
    return list;
  }

  /** Whether a pending prompt exists for the session. */
  hasPendingForSession(agentId: string, sessionKey: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.agentId === agentId && entry.sessionKey === sessionKey) return true;
    }
    return false;
  }
}

function snapshotOf(entry: PendingEntry): PendingHitlSnapshot {
  return {
    agentId: entry.agentId,
    sessionKey: entry.sessionKey,
    toolCallId: entry.toolCallId,
    toolName: entry.toolName,
    kind: entry.kind,
    question: entry.question,
    createdAt: entry.createdAt,
    timeoutMs: entry.timeoutMs,
  };
}

/**
 * Strict yes/no parser. Returns 'yes' | 'no' for exact matches
 * (case-insensitive, whitespace-trimmed). Anything else returns null so
 * the caller can re-prompt.
 */
export function parseConfirm(raw: string): 'yes' | 'no' | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'yes') return 'yes';
  if (normalized === 'no') return 'no';
  return null;
}
