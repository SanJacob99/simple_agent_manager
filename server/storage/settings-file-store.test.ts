import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  SettingsFileStore,
  DEFAULT_SAFETY_SETTINGS,
  LEGACY_CONFIRMATION_POLICIES,
} from './settings-file-store';

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
      safety: { ...DEFAULT_SAFETY_SETTINGS },
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
    // Missing `safety` is filled in from defaults on load, so compare the
    // fields we wrote and check safety fell back to defaults.
    expect(loaded.apiKeys).toEqual(data.apiKeys);
    expect(loaded.agentDefaults).toEqual(data.agentDefaults);
    expect(loaded.storageDefaults).toEqual(data.storageDefaults);
    expect(loaded.safety).toEqual(DEFAULT_SAFETY_SETTINGS);
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

  it('upgrades every legacy confirmation policy to the current default', async () => {
    for (const legacy of LEGACY_CONFIRMATION_POLICIES) {
      await store.save({
        apiKeys: {},
        agentDefaults: {},
        storageDefaults: {},
        safety: { allowDisableHitl: false, confirmationPolicy: legacy },
      });
      const loaded = await store.load();
      expect(loaded.safety?.confirmationPolicy).toBe(
        DEFAULT_SAFETY_SETTINGS.confirmationPolicy,
      );
    }
  });

  it('preserves a user-customized confirmation policy on load', async () => {
    const custom = '## My custom policy\n\nBe careful.';
    await store.save({
      apiKeys: {},
      agentDefaults: {},
      storageDefaults: {},
      safety: { allowDisableHitl: false, confirmationPolicy: custom },
    });
    const loaded = await store.load();
    expect(loaded.safety?.confirmationPolicy).toBe(custom);
  });
});
