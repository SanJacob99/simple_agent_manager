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
            systemPromptMode: 'manual' as const,
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
            systemPromptMode: 'manual' as const,
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
            systemPromptMode: 'manual' as const,
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

  it('passes through storage path without modification', () => {
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
            systemPromptMode: 'manual' as const,
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

    // Tilde expansion happens in StorageEngine, not during resolution
    expect(config?.storage?.storagePath).toBe('~/.simple-agent-manager/storage');
  });

  it('resolves a structured ResolvedSystemPrompt in auto mode', () => {
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
            systemPrompt: 'Ignored in auto mode',
            systemPromptMode: 'auto',
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
      { safetyGuardrails: '## Safety\nBe safe.' },
    );

    expect(config?.systemPrompt.mode).toBe('auto');
    expect(config?.systemPrompt.assembled).toContain('Be safe.');
    expect(config?.systemPrompt.assembled).not.toContain('Ignored in auto mode');
    expect(config?.systemPrompt.sections.find(s => s.key === 'safety')).toBeDefined();
  });

  it('resolves append mode with user instructions at the end', () => {
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
            systemPrompt: 'Always be concise.',
            systemPromptMode: 'append',
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
      { safetyGuardrails: '## Safety\nBe safe.' },
    );

    expect(config?.systemPrompt.mode).toBe('append');
    expect(config?.systemPrompt.assembled).toContain('Be safe.');
    expect(config?.systemPrompt.assembled).toContain('Always be concise.');
    expect(config?.systemPrompt.userInstructions).toBe('Always be concise.');
  });

  it('resolves manual mode with only user text', () => {
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
            systemPrompt: 'Full custom prompt.',
            systemPromptMode: 'manual',
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
      { safetyGuardrails: '## Safety\nBe safe.' },
    );

    expect(config?.systemPrompt.mode).toBe('manual');
    expect(config?.systemPrompt.assembled).toBe('Full custom prompt.');
    expect(config?.systemPrompt.assembled).not.toContain('Be safe.');
  });
});
