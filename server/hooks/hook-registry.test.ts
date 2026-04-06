// server/hooks/hook-registry.test.ts

import { describe, it, expect, vi } from 'vitest';
import { HookRegistry } from './hook-registry';
import type { HookRegistration } from './hook-types';

describe('HookRegistry', () => {
  it('invokes handlers in priority order', async () => {
    const registry = new HookRegistry();
    const order: number[] = [];

    registry.register('test_hook', {
      pluginId: 'b',
      handler: () => { order.push(2); },
      priority: 200,
      critical: false,
    });

    registry.register('test_hook', {
      pluginId: 'a',
      handler: () => { order.push(1); },
      priority: 50,
      critical: false,
    });

    registry.register('test_hook', {
      pluginId: 'c',
      handler: () => { order.push(3); },
      priority: 300,
      critical: false,
    });

    await registry.invoke('test_hook', {});
    expect(order).toEqual([1, 2, 3]);
  });

  it('waterfall: context mutations pass through the chain', async () => {
    const registry = new HookRegistry();

    registry.register<{ value: number }>('test_hook', {
      pluginId: 'first',
      handler: (ctx) => { ctx.value += 10; },
      priority: 100,
      critical: false,
    });

    registry.register<{ value: number }>('test_hook', {
      pluginId: 'second',
      handler: (ctx) => { ctx.value *= 2; },
      priority: 200,
      critical: false,
    });

    const result = await registry.invoke('test_hook', { value: 5 });
    expect(result.value).toBe(30); // (5 + 10) * 2
  });

  it('non-critical handler error logs and continues', async () => {
    const registry = new HookRegistry();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    registry.register<{ value: number }>('test_hook', {
      pluginId: 'failing',
      handler: () => { throw new Error('boom'); },
      priority: 100,
      critical: false,
    });

    registry.register<{ value: number }>('test_hook', {
      pluginId: 'succeeding',
      handler: (ctx) => { ctx.value = 42; },
      priority: 200,
      critical: false,
    });

    const result = await registry.invoke('test_hook', { value: 0 });
    expect(result.value).toBe(42);
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('failing/test_hook'),
    );

    spy.mockRestore();
  });

  it('critical handler error stops the chain and throws', async () => {
    const registry = new HookRegistry();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const afterHandler = vi.fn();

    registry.register('test_hook', {
      pluginId: 'critical_plugin',
      handler: () => { throw new Error('critical failure'); },
      priority: 100,
      critical: true,
    });

    registry.register('test_hook', {
      pluginId: 'after',
      handler: afterHandler,
      priority: 200,
      critical: false,
    });

    await expect(registry.invoke('test_hook', {})).rejects.toThrow(
      'Critical hook error',
    );
    expect(afterHandler).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('destroy prevents future invocations', async () => {
    const registry = new HookRegistry();
    const handler = vi.fn();

    registry.register('test_hook', {
      pluginId: 'test',
      handler,
      priority: 100,
      critical: false,
    });

    registry.destroy();
    await registry.invoke('test_hook', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('destroy prevents future registrations', () => {
    const registry = new HookRegistry();
    registry.destroy();

    const unsub = registry.register('test_hook', {
      pluginId: 'test',
      handler: () => {},
      priority: 100,
      critical: false,
    });

    expect(registry.has('test_hook')).toBe(false);
    // unsub should be a no-op
    unsub();
  });

  it('unregister function removes the handler', async () => {
    const registry = new HookRegistry();
    const handler = vi.fn();

    const unsub = registry.register('test_hook', {
      pluginId: 'test',
      handler,
      priority: 100,
      critical: false,
    });

    expect(registry.count('test_hook')).toBe(1);
    unsub();
    expect(registry.count('test_hook')).toBe(0);

    await registry.invoke('test_hook', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('has() returns false for unregistered hooks', () => {
    const registry = new HookRegistry();
    expect(registry.has('nonexistent')).toBe(false);
  });

  it('has() returns true for registered hooks', () => {
    const registry = new HookRegistry();
    registry.register('test_hook', {
      pluginId: 'test',
      handler: () => {},
      priority: 100,
      critical: false,
    });
    expect(registry.has('test_hook')).toBe(true);
  });

  it('returns context unchanged when no handlers exist', async () => {
    const registry = new HookRegistry();
    const ctx = { value: 10 };
    const result = await registry.invoke('nonexistent', ctx);
    expect(result).toBe(ctx);
    expect(result.value).toBe(10);
  });

  it('supports async handlers', async () => {
    const registry = new HookRegistry();

    registry.register<{ value: number }>('test_hook', {
      pluginId: 'async_plugin',
      handler: async (ctx) => {
        await new Promise((r) => setTimeout(r, 10));
        ctx.value = 99;
      },
      priority: 100,
      critical: false,
    });

    const result = await registry.invoke('test_hook', { value: 0 });
    expect(result.value).toBe(99);
  });

  it('handles multiple hooks independently', async () => {
    const registry = new HookRegistry();

    const hookAHandler = vi.fn();
    const hookBHandler = vi.fn();

    registry.register('hook_a', {
      pluginId: 'test',
      handler: hookAHandler,
      priority: 100,
      critical: false,
    });

    registry.register('hook_b', {
      pluginId: 'test',
      handler: hookBHandler,
      priority: 100,
      critical: false,
    });

    await registry.invoke('hook_a', {});
    expect(hookAHandler).toHaveBeenCalledTimes(1);
    expect(hookBHandler).not.toHaveBeenCalled();
  });
});
