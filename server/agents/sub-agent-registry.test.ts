import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubAgentRegistry, type ResumePayload } from './sub-agent-registry';

const PARENT_KEY = 'agent:p:main';
const PARENT_AGENT = 'p';
const PARENT_RUN = 'run-parent';

function spawnChild(reg: SubAgentRegistry, runId: string, targetAgentId = 'c') {
  return reg.spawn(
    { sessionKey: PARENT_KEY, runId: PARENT_RUN },
    {
      agentId: targetAgentId,
      sessionKey: `sub:${PARENT_KEY}:${runId}`,
      runId,
      subAgentName: 'helper',
      appliedOverrides: {},
    },
  );
}

describe('SubAgentRegistry record lifecycle', () => {
  it('spawn registers a sub-agent and listForParent returns it', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      {
        agentId: 'a1',
        sessionKey: 'sub:agent:a1:main:abc',
        runId: 'run-2',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );

    expect(record.subAgentId).toBeDefined();
    expect(record.status).toBe('running');

    const list = registry.listForParent('agent:a1:main');
    expect(list).toHaveLength(1);
    expect(list[0].sessionKey).toBe('sub:agent:a1:main:abc');
  });

  it('onComplete updates status and stores result', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      {
        agentId: 'a1',
        sessionKey: 'sub:agent:a1:main:abc',
        runId: 'run-2',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );

    registry.onComplete(record.runId, 'Task done');

    const updated = registry.get(record.subAgentId);
    expect(updated?.status).toBe('completed');
    expect(updated?.result).toBe('Task done');
    expect(updated?.endedAt).toBeDefined();
  });

  it('onError updates status and stores error', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      {
        agentId: 'a1',
        sessionKey: 'sub:agent:a1:main:abc',
        runId: 'run-2',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );

    registry.onError(record.runId, 'Something broke');

    const updated = registry.get(record.subAgentId);
    expect(updated?.status).toBe('error');
    expect(updated?.error).toBe('Something broke');
  });

  it('kill marks sub-agent as killed', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      {
        agentId: 'a1',
        sessionKey: 'sub:agent:a1:main:abc',
        runId: 'run-2',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );

    const killed = registry.kill(record.subAgentId);
    expect(killed).toBe(true);

    const updated = registry.get(record.subAgentId);
    expect(updated?.status).toBe('killed');
    expect(updated?.error).toBe('Killed');
  });

  it('allComplete returns true when all sub-agents for parent are done', () => {
    const registry = new SubAgentRegistry();
    const r1 = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      {
        agentId: 'a1',
        sessionKey: 'sub:agent:a1:main:abc',
        runId: 'run-2',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );
    const r2 = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      {
        agentId: 'a1',
        sessionKey: 'sub:agent:a1:main:def',
        runId: 'run-3',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );

    expect(registry.allComplete('agent:a1:main')).toBe(false);
    registry.onComplete(r1.runId, 'done 1');
    expect(registry.allComplete('agent:a1:main')).toBe(false);
    registry.onComplete(r2.runId, 'done 2');
    expect(registry.allComplete('agent:a1:main')).toBe(true);
  });

  it('get returns null for unknown subAgentId', () => {
    const registry = new SubAgentRegistry();
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('kill returns false for unknown subAgentId', () => {
    const registry = new SubAgentRegistry();
    expect(registry.kill('nonexistent')).toBe(false);
  });
});

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

  it('resolves with all-complete when a child errors as the last running sub', () => {
    spawnChild(reg, 'r1');
    spawnChild(reg, 'r2');
    const resolve = vi.fn<(p: ResumePayload) => void>();

    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 60_000 },
      resolve,
    );

    reg.onComplete('r1', 'ok');
    expect(resolve).not.toHaveBeenCalled();

    reg.onError('r2', 'rate limited');
    expect(resolve).toHaveBeenCalledTimes(1);

    const payload = resolve.mock.calls[0][0];
    expect(payload.reason).toBe('all-complete');
    const sortedStatuses = payload.results.map((r) => r.status).sort();
    expect(sortedStatuses).toEqual(['completed', 'error']);
    const erroredResult = payload.results.find((r) => r.status === 'error');
    expect(erroredResult?.error).toBe('rate limited');
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

  it('cancelAllYields cancels every outstanding yield', () => {
    const PARENT_KEY_2 = 'agent:p:other';
    const PARENT_RUN_2 = 'run-parent-2';

    spawnChild(reg, 'r1');
    reg.spawn(
      { sessionKey: PARENT_KEY_2, runId: PARENT_RUN_2 },
      {
        agentId: 'c',
        sessionKey: `sub:${PARENT_KEY_2}:r2`,
        runId: 'r2',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );

    const resolveA = vi.fn<(p: ResumePayload) => void>();
    const resolveB = vi.fn<(p: ResumePayload) => void>();
    reg.setYieldPending(
      PARENT_KEY,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN, timeoutMs: 5_000 },
      resolveA,
    );
    reg.setYieldPending(
      PARENT_KEY_2,
      { parentAgentId: PARENT_AGENT, parentRunId: PARENT_RUN_2, timeoutMs: 5_000 },
      resolveB,
    );

    reg.cancelAllYields();

    vi.advanceTimersByTime(60_000);
    expect(resolveA).not.toHaveBeenCalled();
    expect(resolveB).not.toHaveBeenCalled();
    expect(reg.isYieldPending(PARENT_KEY)).toBe(false);
    expect(reg.isYieldPending(PARENT_KEY_2)).toBe(false);
  });

  it('starts unsealed on spawn', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: { modelId: 'foo' },
      },
    );
    expect(record.sealed).toBe(false);
    expect(record.appliedOverrides).toEqual({ modelId: 'foo' });
  });

  it('onComplete seals the record', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );
    registry.onComplete('cr1', 'done');
    expect(registry.get(record.subAgentId)?.status).toBe('completed');
    expect(registry.isSealed('sub:agent:a:main:helper:abc')).toBe(true);
  });

  it('kill flips status to "killed" and seals', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );
    expect(registry.kill(record.subAgentId)).toBe(true);
    const updated = registry.get(record.subAgentId);
    expect(updated?.status).toBe('killed');
    expect(updated?.sealed).toBe(true);
  });

  it('onError after kill does NOT overwrite the killed status', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );
    registry.kill(record.subAgentId);
    registry.onError('cr1', 'aborted');
    expect(registry.get(record.subAgentId)?.status).toBe('killed');
  });

  it('findBySessionKey returns the record', () => {
    const registry = new SubAgentRegistry();
    registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:helper:abc',
        runId: 'cr1',
        subAgentName: 'helper',
        appliedOverrides: {},
      },
    );
    const r = registry.findBySessionKey('sub:agent:a:main:helper:abc');
    expect(r?.runId).toBe('cr1');
  });
});
