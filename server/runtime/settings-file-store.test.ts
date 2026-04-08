import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SettingsFileStore } from './settings-file-store';

let tmpDir: string;
let store: SettingsFileStore;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-settings-'));
  store = new SettingsFileStore(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('SettingsFileStore', () => {
  it('returns empty defaults when file does not exist', async () => {
    const settings = await store.load();
    expect(settings).toEqual({
      apiKeys: {},
      agentDefaults: {},
      storageDefaults: {},
    });
  });

  it('saves and loads settings', async () => {
    const data = {
      apiKeys: { openrouter: 'key-123' },
      agentDefaults: { provider: 'openai' },
      storageDefaults: { storagePath: '/tmp/test' },
    };
    await store.save(data);

    const loaded = await store.load();
    expect(loaded).toEqual(data);
  });

  it('overwrites existing settings on save', async () => {
    await store.save({
      apiKeys: { openrouter: 'old-key' },
      agentDefaults: {},
      storageDefaults: {},
    });

    await store.save({
      apiKeys: { anthropic: 'new-key' },
      agentDefaults: { provider: 'anthropic' },
      storageDefaults: {},
    });

    const loaded = await store.load();
    expect(loaded.apiKeys).toEqual({ anthropic: 'new-key' });
    expect(loaded.agentDefaults).toEqual({ provider: 'anthropic' });
  });

  it('creates parent directory if it does not exist', async () => {
    const nested = path.join(tmpDir, 'sub', 'dir');
    const nestedStore = new SettingsFileStore(nested);
    await nestedStore.save({ apiKeys: { x: 'y' }, agentDefaults: {}, storageDefaults: {} });

    const loaded = await nestedStore.load();
    expect(loaded.apiKeys).toEqual({ x: 'y' });
  });

  it('getFilePath returns expected path', () => {
    expect(store.getFilePath()).toBe(path.join(tmpDir, 'settings.json'));
  });
});
