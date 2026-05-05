import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageEngine } from '../storage/storage-engine';
import { ChannelSessionStore } from './channel-session-store';
import type { ResolvedStorageConfig } from '../../shared/agent-config';

function makeTempConfig(storagePath: string): ResolvedStorageConfig {
  return {
    label: 'Test Storage',
    backendType: 'filesystem',
    storagePath,
    sessionRetention: 50,
    memoryEnabled: false,
    dailyMemoryEnabled: false,
    dailyResetEnabled: false,
    dailyResetHour: 4,
    idleResetEnabled: false,
    idleResetMinutes: 60,
    parentForkMaxTokens: 100000,
    maintenanceMode: 'warn',
    pruneAfterDays: 30,
    maxEntries: 100,
    rotateBytes: 10 * 1024 * 1024,
    resetArchiveRetentionDays: 7,
    maxDiskBytes: 0,
    highWaterPercent: 80,
    maintenanceIntervalMinutes: 60,
  };
}

describe('ChannelSessionStore', () => {
  let store: ChannelSessionStore;
  let storage: StorageEngine;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'chan-'));
    const config = makeTempConfig(tempDir);
    storage = new StorageEngine(config, 'agent-a');
    await storage.init();
    store = new ChannelSessionStore({ ownerStorage: () => storage });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('opens a fresh channel with empty meta', async () => {
    const ch = await store.open({ pair: ['agent-a', 'agent-b'], pairNames: ['alpha', 'beta'] });
    expect(ch.meta.turns).toBe(0);
    expect(ch.meta.sealed).toBe(false);
    expect(ch.meta.pair).toEqual(['agent-a', 'agent-b']);
    expect(ch.meta.pairNames).toEqual(['alpha', 'beta']);
    expect(ch.meta.ownerAgentId).toBe('agent-a');
  });

  it('opening an existing channel returns its current meta', async () => {
    const a = await store.open({ pair: ['agent-a', 'agent-b'], pairNames: ['alpha', 'beta'] });
    await store.appendUserMessage(a.key, {
      content: 'hi',
      meta: {
        from: 'agent:alpha', fromAgentId: 'agent-a',
        to: 'agent:beta', toAgentId: 'agent-b',
        depth: 1, channelKey: a.key,
      },
    });
    const b = await store.open({ pair: ['agent-a', 'agent-b'], pairNames: ['alpha', 'beta'] });
    expect(b.meta.turns).toBe(1);
  });

  it('appendUserMessage bumps turns and persists meta', async () => {
    const ch = await store.open({ pair: ['agent-a', 'agent-b'], pairNames: ['alpha', 'beta'] });
    await store.appendUserMessage(ch.key, {
      content: 'hello',
      meta: {
        from: 'agent:alpha', fromAgentId: 'agent-a',
        to: 'agent:beta', toAgentId: 'agent-b',
        depth: 1, channelKey: ch.key,
      },
    });
    const reloaded = await store.read(ch.key);
    expect(reloaded.meta.turns).toBe(1);
  });

  it('seal marks the channel and persists reason', async () => {
    const ch = await store.open({ pair: ['agent-a', 'agent-b'], pairNames: ['alpha', 'beta'] });
    await store.seal(ch.key, 'max_turns_reached');
    const reloaded = await store.read(ch.key);
    expect(reloaded.meta.sealed).toBe(true);
    expect(reloaded.meta.sealedReason).toBe('max_turns_reached');
  });

  it('addUsage increments tokens', async () => {
    const ch = await store.open({ pair: ['agent-a', 'agent-b'], pairNames: ['alpha', 'beta'] });
    await store.addUsage(ch.key, { tokensIn: 100, tokensOut: 50 });
    const reloaded = await store.read(ch.key);
    expect(reloaded.meta.tokensIn).toBe(100);
    expect(reloaded.meta.tokensOut).toBe(50);
  });

  it('appendUserMessage on a sealed channel throws', async () => {
    const ch = await store.open({ pair: ['agent-a', 'agent-b'], pairNames: ['alpha', 'beta'] });
    await store.seal(ch.key, 'max_turns_reached');
    await expect(
      store.appendUserMessage(ch.key, {
        content: 'x',
        meta: {
          from: 'agent:alpha', fromAgentId: 'agent-a',
          to: 'agent:beta', toAgentId: 'agent-b',
          depth: 1, channelKey: ch.key,
        },
      }),
    ).rejects.toThrow();
  });

  it('tail returns recent transcript events', async () => {
    const ch = await store.open({ pair: ['agent-a', 'agent-b'], pairNames: ['alpha', 'beta'] });
    for (let i = 0; i < 3; i++) {
      await store.appendUserMessage(ch.key, {
        content: `msg ${i}`,
        meta: {
          from: 'agent:alpha', fromAgentId: 'agent-a',
          to: 'agent:beta', toAgentId: 'agent-b',
          depth: 1, channelKey: ch.key,
        },
      });
    }
    const events = await store.tail(ch.key, 10);
    expect(events.length).toBeGreaterThanOrEqual(3);
  });

  it('open() sorts pair internally regardless of caller order', async () => {
    // Caller passes hi-sorted first: ['agent-b', 'agent-a']
    const ch = await store.open({ pair: ['agent-b', 'agent-a'], pairNames: ['beta', 'alpha'] });
    // lo is 'agent-a', so everything should be aligned to that order
    expect(ch.meta.pair).toEqual(['agent-a', 'agent-b']);
    expect(ch.meta.pairNames).toEqual(['alpha', 'beta']);  // names re-aligned
    expect(ch.meta.ownerAgentId).toBe('agent-a');
  });
});
