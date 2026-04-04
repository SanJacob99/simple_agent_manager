import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { StorageEngine } from './storage-engine';
import type { ResolvedStorageConfig } from './agent-config';

function makeTempConfig(overrides?: Partial<ResolvedStorageConfig>): ResolvedStorageConfig {
  return {
    label: 'Test Storage',
    backendType: 'filesystem',
    storagePath: path.join(os.tmpdir(), `sam-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    sessionRetention: 50,
    memoryEnabled: true,
    dailyMemoryEnabled: true,
    ...overrides,
  };
}

describe('StorageEngine', () => {
  let config: ResolvedStorageConfig;
  let engine: StorageEngine;

  beforeEach(async () => {
    config = makeTempConfig();
    engine = new StorageEngine(config, 'test-agent');
    await engine.init();
  });

  afterEach(async () => {
    await fs.rm(config.storagePath, { recursive: true, force: true });
  });

  describe('directory structure', () => {
    it('creates agent sessions and memory directories on init', async () => {
      const sessionsDir = path.join(config.storagePath, 'test-agent', 'sessions');
      const memoryDir = path.join(config.storagePath, 'test-agent', 'memory');
      const sessionsStat = await fs.stat(sessionsDir);
      const memoryStat = await fs.stat(memoryDir);
      expect(sessionsStat.isDirectory()).toBe(true);
      expect(memoryStat.isDirectory()).toBe(true);
    });

    it('expands tilde in storage path to home directory', async () => {
      const tildeConfig = makeTempConfig({
        storagePath: '~/.sam-tilde-test',
      });
      const tildeEngine = new StorageEngine(tildeConfig, 'test-agent');
      await tildeEngine.init();

      const expectedDir = path.join(os.homedir(), '.sam-tilde-test', 'test-agent', 'sessions');
      const stat = await fs.stat(expectedDir);
      expect(stat.isDirectory()).toBe(true);

      await fs.rm(path.join(os.homedir(), '.sam-tilde-test'), { recursive: true, force: true });
    });

    it('skips memory directory when memoryEnabled is false', async () => {
      const noMemConfig = makeTempConfig({ memoryEnabled: false });
      const noMemEngine = new StorageEngine(noMemConfig, 'test-agent');
      await noMemEngine.init();

      const sessionsDir = path.join(noMemConfig.storagePath, 'test-agent', 'sessions');
      const memoryDir = path.join(noMemConfig.storagePath, 'test-agent', 'memory');
      expect((await fs.stat(sessionsDir)).isDirectory()).toBe(true);
      await expect(fs.stat(memoryDir)).rejects.toThrow();

      await fs.rm(noMemConfig.storagePath, { recursive: true, force: true });
    });
  });

  describe('session CRUD', () => {
    it('creates a session and lists it', async () => {
      await engine.createSession({
        sessionId: 'sess-1',
        agentName: 'test-agent',
        llmSlug: 'anthropic/claude-sonnet-4-20250514',
        startedAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        sessionFile: 'sessions/sess-1.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      });

      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-1');
    });

    it('deletes a session and its JSONL file', async () => {
      await engine.createSession({
        sessionId: 'sess-del',
        agentName: 'test-agent',
        llmSlug: 'anthropic/claude-sonnet-4-20250514',
        startedAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        sessionFile: 'sessions/sess-del.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      });

      await engine.deleteSession('sess-del');
      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(0);
    });

    it('updates session metadata partially', async () => {
      await engine.createSession({
        sessionId: 'sess-upd',
        agentName: 'test-agent',
        llmSlug: 'anthropic/claude-sonnet-4-20250514',
        startedAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        sessionFile: 'sessions/sess-upd.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      });

      await engine.updateSessionMeta('sess-upd', {
        totalInputTokens: 5000,
        totalOutputTokens: 1200,
        totalTokens: 6200,
        updatedAt: '2026-04-03T10:15:00.000Z',
      });

      const meta = await engine.getSessionMeta('sess-upd');
      expect(meta?.totalInputTokens).toBe(5000);
      expect(meta?.totalOutputTokens).toBe(1200);
      expect(meta?.totalTokens).toBe(6200);
    });
  });

  describe('JSONL entries', () => {
    it('appends and reads session entries', async () => {
      await engine.createSession({
        sessionId: 'sess-jsonl',
        agentName: 'test-agent',
        llmSlug: 'anthropic/claude-sonnet-4-20250514',
        startedAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        sessionFile: 'sessions/sess-jsonl.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      });

      await engine.appendEntry('sess-jsonl', {
        type: 'session',
        id: 'entry-1',
        parentId: null,
        timestamp: '2026-04-03T10:00:00.000Z',
        version: 3,
        sessionId: 'sess-jsonl',
      });

      await engine.appendEntry('sess-jsonl', {
        type: 'message',
        id: 'entry-2',
        parentId: 'entry-1',
        timestamp: '2026-04-03T10:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      });

      const entries = await engine.readEntries('sess-jsonl');
      expect(entries).toHaveLength(2);
      expect(entries[0].type).toBe('session');
      expect(entries[1].type).toBe('message');
      expect(entries[1].parentId).toBe('entry-1');
    });
  });

  describe('session retention', () => {
    it('prunes oldest sessions beyond retention limit', async () => {
      for (let i = 0; i < 5; i++) {
        await engine.createSession({
          sessionId: `sess-${i}`,
          agentName: 'test-agent',
          llmSlug: 'anthropic/claude-sonnet-4-20250514',
          startedAt: `2026-04-0${i + 1}T10:00:00.000Z`,
          updatedAt: `2026-04-0${i + 1}T10:00:00.000Z`,
          sessionFile: `sessions/sess-${i}.jsonl`,
          contextTokens: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalEstimatedCostUsd: 0,
          totalTokens: 0,
        });
      }

      await engine.enforceRetention(3);
      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(3);
      const ids = sessions.map((s) => s.sessionId);
      expect(ids).toContain('sess-4');
      expect(ids).toContain('sess-3');
      expect(ids).toContain('sess-2');
      expect(ids).not.toContain('sess-0');
      expect(ids).not.toContain('sess-1');
    });
  });

  describe('memory files', () => {
    it('appends and reads daily memory', async () => {
      await engine.appendDailyMemory('First note\n', '2026-04-03');
      await engine.appendDailyMemory('Second note\n', '2026-04-03');

      const content = await engine.readDailyMemory('2026-04-03');
      expect(content).toContain('First note');
      expect(content).toContain('Second note');
    });

    it('writes and reads long-term memory', async () => {
      await engine.writeLongTermMemory('# Agent Memory\n\n- Important fact');
      const content = await engine.readLongTermMemory();
      expect(content).toBe('# Agent Memory\n\n- Important fact');
    });

    it('returns null for non-existent memory files', async () => {
      const daily = await engine.readDailyMemory('2020-01-01');
      expect(daily).toBeNull();

      const longTerm = await engine.readLongTermMemory();
      expect(longTerm).toBeNull();
    });

    it('lists memory files with metadata', async () => {
      await engine.writeLongTermMemory('# Memory');
      await engine.appendDailyMemory('Note', '2026-04-03');

      const files = await engine.listMemoryFiles();
      expect(files.length).toBeGreaterThanOrEqual(2);

      const longTermFile = files.find((f) => f.name === 'MEMORY.md');
      expect(longTermFile?.isEvergreen).toBe(true);
      expect(longTermFile?.date).toBeNull();

      const dailyFile = files.find((f) => f.name === '2026-04-03.md');
      expect(dailyFile?.isEvergreen).toBe(false);
      expect(dailyFile?.date).toBe('2026-04-03');
    });
  });
});
