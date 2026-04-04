import { describe, expect, it } from 'vitest';
import { resolveAgentConfig } from './graph-to-agent';

describe('resolveAgentConfig', () => {
  it('carries per-agent capability overrides into runtime config', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            systemPrompt: 'Test',
            provider: 'openrouter',
            modelId: 'xiaomi/mimo-v2-pro',
            thinkingLevel: 'medium',
            description: '',
            tags: [],
            modelCapabilities: {
              reasoningSupported: false,
              contextWindow: 1234,
            },
          },
        },
      ] as any,
      [],
    );

    expect(config?.modelCapabilities?.reasoningSupported).toBe(false);
    expect(config?.modelCapabilities?.contextWindow).toBe(1234);
  });

  it('resolves a connected storage node into config.storage', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Test',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
        {
          id: 'storage-1',
          type: 'storage',
          position: { x: -200, y: 0 },
          data: {
            type: 'storage',
            label: 'Storage',
            backendType: 'filesystem',
            storagePath: '/home/user/.simple-agent-manager/storage',
            sessionRetention: 50,
            memoryEnabled: true,
            dailyMemoryEnabled: true,
          },
        },
      ] as any,
      [{ id: 'e1', source: 'storage-1', target: 'agent-1', type: 'data' }] as any,
    );

    expect(config?.storage).not.toBeNull();
    expect(config?.storage?.backendType).toBe('filesystem');
    expect(config?.storage?.storagePath).toBe('/home/user/.simple-agent-manager/storage');
    expect(config?.storage?.sessionRetention).toBe(50);
    expect(config?.storage?.memoryEnabled).toBe(true);
  });

  it('returns storage as null when no storage node is connected', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Test',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
      ] as any,
      [],
    );

    expect(config?.storage).toBeNull();
  });

  it('expands tilde in storage path during resolution', () => {
    const config = resolveAgentConfig(
      'agent-1',
      [
        {
          id: 'agent-1',
          type: 'agent',
          position: { x: 0, y: 0 },
          data: {
            type: 'agent',
            name: 'Agent',
            nameConfirmed: true,
            systemPrompt: 'Test',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-20250514',
            thinkingLevel: 'off',
            description: '',
            tags: [],
            modelCapabilities: {},
          },
        },
        {
          id: 'storage-1',
          type: 'storage',
          position: { x: -200, y: 0 },
          data: {
            type: 'storage',
            label: 'Storage',
            backendType: 'filesystem',
            storagePath: '~/.simple-agent-manager/storage',
            sessionRetention: 50,
            memoryEnabled: true,
            dailyMemoryEnabled: true,
          },
        },
      ] as any,
      [{ id: 'e1', source: 'storage-1', target: 'agent-1', type: 'data' }] as any,
    );

    expect(config?.storage?.storagePath).not.toContain('~');
    // Should be an absolute path (starts with / on unix or drive letter on Windows)
    expect(config?.storage?.storagePath).toMatch(/^(\/|[A-Z]:\\)/);
  });
});
