import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubAgentRegistry, type ResumePayload } from './sub-agent-registry';

const PARENT_KEY = 'agent:p:main';
const PARENT_AGENT = 'p';
const PARENT_RUN = 'run-parent';

function spawnChild(reg: SubAgentRegistry, runId: string, targetAgentId = 'c') {
  return reg.spawn(
    { sessionKey: PARENT_KEY, runId: PARENT_RUN },
    { agentId: targetAgentId, sessionKey: `sub:${PARENT_KEY}:${runId}`, runId },
  );
}

describe('SubAgentRegistry yield orchestration', () => {
  let reg: SubAgentRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    reg = new SubAgentRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns no-active-subs when no children are running', () => {
    const resolve = vi.fn();
    const result = reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 10_000 },
      resolve,
    );
    expect(result).toEqual({ setupOk: false, reason: 'no-active-subs' });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('returns already-pending on a second setYieldPending for the same parent', () => {
    spawnChild(reg, 'r1');
    const r1 = reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 10_000 },
      vi.fn(),
    );
    expect(r1.setupOk).toBe(true);

    const r2 = reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 10_000 },
      vi.fn(),
    );
    expect(r2).toEqual({ setupOk: false, reason: 'already-pending' });
  });

  it('resolves with all-complete when the last running child completes', () => {
    spawnChild(reg, 'r1');
    spawnChild(reg, 'r2');
    const resolve = vi.fn<(p: ResumePayload) => void>();

    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 60_000 },
      resolve,
    );

    reg.onComplete('r1', 'first reply');
    expect(resolve).not.toHaveBeenCalled();

    reg.onComplete('r2', 'second reply');
    expect(resolve).toHaveBeenCalledTimes(1);

    const payload = resolve.mock.calls[0][0];
    expect(payload.reason).toBe('all-complete');
    expect(payload.parentSessionKey).toBe(PARENT_KEY);
    expect(payload.parentAgentId).toBe(PARENT_AGENT);
    expect(payload.parentRunId).toBe(PARENT_RUN);
    expect(payload.results).toHaveLength(2);
    expect(payload.results.map((r) => r.status)).toEqual(['completed', 'completed']);
    expect(payload.results.map((r) => r.text)).toEqual(['first reply', 'second reply']);
  });

  it('resolves with timeout when subs do not finish in time', () => {
    spawnChild(reg, 'r1');
    spawnChild(reg, 'r2');
    const resolve = vi.fn<(p: ResumePayload) => void>();

    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 5_000 },
      resolve,
    );

    reg.onComplete('r1', 'first reply');
    expect(resolve).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);

    expect(resolve).toHaveBeenCalledTimes(1);
    const payload = resolve.mock.calls[0][0];
    expect(payload.reason).toBe('timeout');
    const statuses = payload.results.map((r) => r.status).sort();
    expect(statuses).toEqual(['completed', 'running']);
  });

  it('does not double-resolve when both timeout and final completion fire', () => {
    spawnChild(reg, 'r1');
    const resolve = vi.fn<(p: ResumePayload) => void>();

    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 5_000 },
      resolve,
    );

    vi.advanceTimersByTime(5_000);
    reg.onComplete('r1', 'late reply');

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('cancelYield clears the timer and prevents resolve', () => {
    spawnChild(reg, 'r1');
    const resolve = vi.fn<(p: ResumePayload) => void>();

    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 5_000 },
      resolve,
    );

    reg.cancelYield(PARENT_KEY);

    vi.advanceTimersByTime(60_000);
    reg.onComplete('r1', 'reply');

    expect(resolve).not.toHaveBeenCalled();
  });
});
