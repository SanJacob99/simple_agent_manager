import { describe, expect, it } from 'vitest';
import { getDefaultNodeData } from './default-nodes';

describe('getDefaultNodeData', () => {
  it('returns an agent node config', () => {
    const node = getDefaultNodeData('agent');

    expect(node.type).toBe('agent');
    expect(node.provider).toBe('anthropic');
  });

  it('seeds empty agent capability overrides', () => {
    const node = getDefaultNodeData('agent');

    expect(node.type).toBe('agent');
    expect(node.modelCapabilities).toEqual({});
  });
});
