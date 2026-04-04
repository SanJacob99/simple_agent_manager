import { describe, expect, it } from 'vitest';
import { getDefaultNodeData } from './default-nodes';

describe('getDefaultNodeData', () => {
  it('returns an agent node config', () => {
    const node = getDefaultNodeData('agent');

    expect(node.type).toBe('agent');
    expect(node.provider).toBe('anthropic');
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
  });

  it('seeds empty agent capability overrides', () => {
    const node = getDefaultNodeData('agent');

    expect(node.type).toBe('agent');
    expect(node.modelCapabilities).toEqual({});
  });
});
