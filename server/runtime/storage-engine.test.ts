import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { StorageEngine } from './storage-engine';
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionStoreEntry } from '../../shared/storage-types';

function makeTempConfig(overrides?: Partial<ResolvedStorageConfig>): ResolvedStorageConfig {
  return {
    label: 'Test Storage',
    backendType: 'filesystem',
    storagePath: path.join(os.tmpdir(), `sam-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    sessionRetention: 50,
    memoryEnabled: true,
    dailyMemoryEnabled: true,
    dailyResetEnabled: true,
    dailyResetHour: 4,
    idleResetEnabled: false,
    idleResetMinutes: 60,
    parentForkMaxTokens: 100000,
    ...overrides,
  };
}

function makeEntry(overrides?: Partial<SessionStoreEntry>): SessionStoreEntry {
  const now = new Date().toISOString();
  return {
    sessionKey: 'agent:test-agent:main',
    sessionId: 'sess-1',
    agentId: 'agent-node-1',
    sessionFile: 'sessions/sess-1.jsonl',
    createdAt: now,
    updatedAt: now,
    chatType: 'direct',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalEstimatedCostUsd: 0,
    compactionCount: 0,
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
      expect((await fs.stat(sessionsDir)).isDirectory()).toBe(true);
      expect((await fs.stat(memoryDir)).isDirectory()).toBe(true);
    });

    it('expands tilde in storage path to home directory', async () => {
      const tildeConfig = makeTempConfig({ storagePath: '~/.sam-tilde-test' });
      const tildeEngine = new StorageEngine(tildeConfig, 'test-agent');
      await tildeEngine.init();

      const expectedDir = path.join(os.homedir(), '.sam-tilde-test', 'test-agent', 'sessions');
      expect((await fs.stat(expectedDir)).isDirectory()).toBe(true);

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

  describe('session CRUD (sessions.json)', () => {
    it('creates a session and lists it', async () => {
      await engine.createSession(makeEntry());

      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionKey).toBe('agent:test-agent:main');
      expect(sessions[0].sessionId).toBe('sess-1');
    });

    it('stores sessions as a key-value map on disk', async () => {
      await engine.createSession(makeEntry());

      const storePath = path.join(config.storagePath, 'test-agent', 'sessions', 'sessions.json');
      const raw = JSON.parse(await fs.readFile(storePath, 'utf-8'));
      expect(raw['agent:test-agent:main']).toBeDefined();
      expect(raw['agent:test-agent:main'].sessionId).toBe('sess-1');
    });

    it('gets a session by sessionKey', async () => {
      await engine.createSession(makeEntry());

      const found = await engine.getSession('agent:test-agent:main');
      expect(found).not.toBeNull();
      expect(found!.sessionId).toBe('sess-1');
    });

    it('returns null for non-existent sessionKey', async () => {
      const found = await engine.getSession('nonexistent');
      expect(found).toBeNull();
    });

    it('gets a session by sessionId', async () => {
      await engine.createSession(makeEntry());

      const found = await engine.getSessionById('sess-1');
      expect(found).not.toBeNull();
      expect(found!.sessionKey).toBe('agent:test-agent:main');
    });

    it('updates a session partially', async () => {
      await engine.createSession(makeEntry());
      await engine.updateSession('agent:test-agent:main', {
        inputTokens: 5000,
        outputTokens: 1200,
        updatedAt: '2026-04-07T12:00:00.000Z',
      });

      const updated = await engine.getSession('agent:test-agent:main');
      expect(updated?.inputTokens).toBe(5000);
      expect(updated?.outputTokens).toBe(1200);
    });

    it('deletes a session by sessionKey', async () => {
      const transcriptPath = engine.resolveTranscriptPath(makeEntry());
      await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
      await fs.writeFile(transcriptPath, 'test\n', 'utf-8');

      await engine.createSession(makeEntry());
      await engine.deleteSession('agent:test-agent:main');

      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(0);
      await expect(fs.stat(transcriptPath)).rejects.toThrow();
    });

    it('deletes all sessions and transcript files', async () => {
      const main = makeEntry();
      const debug = makeEntry({
        sessionKey: 'agent:test-agent:debug',
        sessionId: 'sess-2',
        sessionFile: 'sessions/sess-2.jsonl',
      });

      for (const entry of [main, debug]) {
        const transcriptPath = engine.resolveTranscriptPath(entry);
        await fs.mkdir(path.dirname(transcriptPath), { recursive: true });
        await fs.writeFile(transcriptPath, 'test\n', 'utf-8');
        await engine.createSession(entry);
      }

      await engine.deleteAllSessions();

      expect(await engine.listSessions()).toEqual([]);
      await expect(fs.stat(engine.resolveTranscriptPath(main))).rejects.toThrow();
      await expect(fs.stat(engine.resolveTranscriptPath(debug))).rejects.toThrow();
    });

    it('lists sessions sorted by updatedAt descending', async () => {
      await engine.createSession(
        makeEntry({
          sessionKey: 'agent:test-agent:old',
          sessionId: 'sess-old',
          updatedAt: '2026-04-01T10:00:00.000Z',
        }),
      );
      await engine.createSession(
        makeEntry({
          sessionKey: 'agent:test-agent:new',
          sessionId: 'sess-new',
          updatedAt: '2026-04-07T10:00:00.000Z',
        }),
      );

      const sessions = await engine.listSessions();
      expect(sessions[0].sessionKey).toBe('agent:test-agent:new');
      expect(sessions[1].sessionKey).toBe('agent:test-agent:old');
    });
  });

  describe('transcript path resolution', () => {
    it('derives a transcript path from sessionId when sessionFile is not set', () => {
      const result = engine.resolveTranscriptPath(makeEntry({ sessionFile: undefined, sessionId: 'abc-123' }));
      expect(result).toContain(path.join('sessions', 'abc-123.jsonl'));
    });

    it('uses sessionFile when explicitly set', () => {
      const result = engine.resolveTranscriptPath(makeEntry({ sessionFile: '/custom/path/transcript.jsonl' }));
      expect(result).toBe('/custom/path/transcript.jsonl');
    });
  });

  describe('session retention', () => {
    it('prunes oldest sessions beyond retention limit', async () => {
      for (let i = 0; i < 5; i++) {
        await engine.createSession(
          makeEntry({
            sessionKey: `agent:test-agent:s${i}`,
            sessionId: `sess-${i}`,
            sessionFile: `sessions/sess-${i}.jsonl`,
            updatedAt: `2026-04-0${i + 1}T10:00:00.000Z`,
          }),
        );
      }

      await engine.enforceRetention(3);

      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(3);
      const keys = sessions.map((session) => session.sessionKey);
      expect(keys).toContain('agent:test-agent:s4');
      expect(keys).toContain('agent:test-agent:s3');
      expect(keys).toContain('agent:test-agent:s2');
      expect(keys).not.toContain('agent:test-agent:s0');
      expect(keys).not.toContain('agent:test-agent:s1');
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
      expect(await engine.readDailyMemory('2020-01-01')).toBeNull();
      expect(await engine.readLongTermMemory()).toBeNull();
    });

    it('lists memory files with metadata', async () => {
      await engine.writeLongTermMemory('# Memory');
      await engine.appendDailyMemory('Note', '2026-04-03');

      const files = await engine.listMemoryFiles();
      expect(files.length).toBeGreaterThanOrEqual(2);

      const longTerm = files.find((file) => file.name === 'MEMORY.md');
      expect(longTerm?.isEvergreen).toBe(true);

      const daily = files.find((file) => file.name === '2026-04-03.md');
      expect(daily?.isEvergreen).toBe(false);
      expect(daily?.date).toBe('2026-04-03');
    });
  });
});
