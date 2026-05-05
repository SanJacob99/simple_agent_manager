import { describe, expect, it } from 'vitest';
import { getDefaultNodeData } from './default-nodes';

describe('getDefaultNodeData', () => {
  it('returns an agent node config', () => {
    const node = getDefaultNodeData('agent');

    expect(node.type).toBe('agent');
    expect(node.systemPromptMode).toBe('append');
  });

  it('returns a storage node config with filesystem defaults', () => {
    const node = getDefaultNodeData('storage');

    expect(node.type).toBe('storage');
    expect(node.label).toBe('Storage');
    expect(node.backendType).toBe('filesystem');
    expect(node.storagePath).toBe('~/.simple-agent-manager/storage');
    expect(node.sessionRetention).toBe(50);
    expect(node.memoryEnabled).toBe(true);
    expect(node.dailyMemoryEnabled).toBe(true);
    expect(node.dailyResetEnabled).toBe(false);
    expect(node.dailyResetHour).toBe(4);
    expect(node.idleResetEnabled).toBe(false);
    expect(node.idleResetMinutes).toBe(60);
    expect(node.parentForkMaxTokens).toBe(100000);
  });

  it('seeds empty agent capability overrides', () => {
    const node = getDefaultNodeData('agent');

    expect(node.type).toBe('agent');
    expect(node.modelCapabilities).toEqual({});
  });

  it('returns provider defaults', () => {
    const data = getDefaultNodeData('provider');
    expect(data.type).toBe('provider');
    if (data.type !== 'provider') throw new Error('unreachable');
    expect(data.pluginId).toBe('openrouter');
    expect(data.authMethodId).toBe('api-key');
    expect(data.envVar).toBe('OPENROUTER_API_KEY');
    expect(data.baseUrl).toBe('');
  });

  it('returns v1 defaults including new loop/safety fields for agentComm', () => {
    const data = getDefaultNodeData('agentComm');
    expect(data).toMatchObject({
      type: 'agentComm',
      label: 'Agent Comm',
      targetAgentNodeId: null,
      protocol: 'direct',
      maxTurns: 10,
      maxDepth: 3,
      tokenBudget: 100_000,
      rateLimitPerMinute: 30,
      messageSizeCap: 16_000,
      direction: 'bidirectional',
    });
  });
});
