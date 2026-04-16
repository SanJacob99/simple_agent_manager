import { describe, expect, it } from 'vitest';
import { SubAgentRegistry } from './sub-agent-registry';

describe('SubAgentRegistry', () => {
  it('spawn registers a sub-agent and listForParent returns it', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
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
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
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
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
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
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
    );

    const killed = registry.kill(record.subAgentId);
    expect(killed).toBe(true);

    const updated = registry.get(record.subAgentId);
    expect(updated?.status).toBe('error');
    expect(updated?.error).toBe('Killed by parent');
  });

  it('yield pending flag lifecycle', () => {
    const registry = new SubAgentRegistry();
    expect(registry.isYieldPending('agent:a1:main')).toBe(false);

    registry.setYieldPending('agent:a1:main');
    expect(registry.isYieldPending('agent:a1:main')).toBe(true);

    registry.clearYieldPending('agent:a1:main');
    expect(registry.isYieldPending('agent:a1:main')).toBe(false);
  });

  it('allComplete returns true when all sub-agents for parent are done', () => {
    const registry = new SubAgentRegistry();
    const r1 = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
    );
    const r2 = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:def', runId: 'run-3' },
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
