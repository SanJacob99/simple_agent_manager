// server/hooks/plugin-loader.test.ts

import { describe, it, expect, vi } from 'vitest';
import { PluginLoader } from './plugin-loader';
import { HookRegistry } from './hook-registry';
import type { PluginDefinition } from '../../shared/agent-config';

// Note: These tests mock the dynamic import to avoid filesystem dependencies.

describe('PluginLoader', () => {
  it('skips disabled plugins', async () => {
    const registry = new HookRegistry();
    const plugins: PluginDefinition[] = [
      {
        id: 'test-plugin',
        name: 'Test Plugin',
        tools: [],
        skills: [],
        hooks: [{ hookName: 'before_model_resolve', handler: './test.js' }],
        enabled: false,
      },
    ];

    const loaded = await PluginLoader.loadPlugins(plugins, registry, '/tmp');
    expect(loaded).toBe(0);
    expect(registry.has('before_model_resolve')).toBe(false);
  });

  it('skips plugins with no hooks', async () => {
    const registry = new HookRegistry();
    const plugins: PluginDefinition[] = [
      {
        id: 'test-plugin',
        name: 'Test Plugin',
        tools: [],
        skills: [],
        hooks: [],
        enabled: true,
      },
    ];

    const loaded = await PluginLoader.loadPlugins(plugins, registry, '/tmp');
    expect(loaded).toBe(0);
  });

  it('returns 0 for undefined plugins', async () => {
    const registry = new HookRegistry();
    const loaded = await PluginLoader.loadPlugins(undefined, registry, '/tmp');
    expect(loaded).toBe(0);
  });

  it('returns 0 for empty plugins array', async () => {
    const registry = new HookRegistry();
    const loaded = await PluginLoader.loadPlugins([], registry, '/tmp');
    expect(loaded).toBe(0);
  });

  it('handles missing module gracefully', async () => {
    const registry = new HookRegistry();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const plugins: PluginDefinition[] = [
      {
        id: 'broken-plugin',
        name: 'Broken Plugin',
        tools: [],
        skills: [],
        hooks: [
          {
            hookName: 'before_model_resolve',
            handler: './nonexistent-module.js',
          },
        ],
        enabled: true,
      },
    ];

    const loaded = await PluginLoader.loadPlugins(plugins, registry, '/tmp');
    expect(loaded).toBe(0);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load handler'),
    );
    expect(registry.has('before_model_resolve')).toBe(false);

    spy.mockRestore();
  });
});
