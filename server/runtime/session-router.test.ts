import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { StorageEngine } from './storage-engine';
import { SessionTranscriptStore } from './session-transcript-store';
import { SessionRouter } from './session-router';
import type { ResolvedStorageConfig } from '../../shared/agent-config';

function makeTempConfig(overrides?: Partial<ResolvedStorageConfig>): ResolvedStorageConfig {
  return {
    label: 'Test Storage',
    backendType: 'filesystem',
    storagePath: path.join(os.tmpdir(), `sam-router-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    sessionRetention: 50,
    memoryEnabled: false,
    dailyMemoryEnabled: false,
    dailyResetEnabled: true,
    dailyResetHour: 4,
    idleResetEnabled: false,
    idleResetMinutes: 60,
    parentForkMaxTokens: 100000,
    ...overrides,
  };
}

describe('SessionRouter', () => {
  let config: ResolvedStorageConfig;
  let engine: StorageEngine;
  let transcripts: SessionTranscriptStore;
  let router: SessionRouter;

  beforeEach(async () => {
    config = makeTempConfig();
    engine = new StorageEngine(config, 'test-agent');
    await engine.init();
    transcripts = new SessionTranscriptStore(engine.getSessionsDir(), process.cwd());
    router = new SessionRouter(engine, transcripts, config, 'agent-node-123');
  });

  afterEach(async () => {
    await fs.rm(config.storagePath, { recursive: true, force: true });
  });

  describe('route()', () => {
    it('creates a new session when none exists for the key', async () => {
      const result = await router.route({ agentId: 'agent-node-123' });

      expect(result.sessionKey).toBe('agent:agent-node-123:main');
      expect(result.sessionId).toBeTruthy();
      expect(result.created).toBe(true);
      expect(result.reset).toBe(false);
      expect((await fs.stat(result.transcriptPath)).isFile()).toBe(true);
    });

    it('returns the existing session on subsequent routes', async () => {
      const first = await router.route({ agentId: 'agent-node-123' });
      const second = await router.route({ agentId: 'agent-node-123' });

      expect(second.sessionKey).toBe(first.sessionKey);
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.created).toBe(false);
      expect(second.reset).toBe(false);
    });

    it('uses the provided subKey in the session key', async () => {
      const result = await router.route({ agentId: 'agent-node-123', subKey: 'debug' });
      expect(result.sessionKey).toBe('agent:agent-node-123:debug');
    });
  });

  describe('reset behavior', () => {
    it('resets sessions when the daily boundary has passed', async () => {
      const first = await router.route({ agentId: 'agent-node-123' });
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      await engine.updateSession(first.sessionKey, {
        updatedAt: yesterday.toISOString(),
      });

      const second = await router.route({ agentId: 'agent-node-123' });

      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.reset).toBe(true);
      expect(second.created).toBe(false);
    });

    it('resets sessions after the idle timeout', async () => {
      const idleConfig = makeTempConfig({
        dailyResetEnabled: false,
        idleResetEnabled: true,
        idleResetMinutes: 1,
      });
      const idleEngine = new StorageEngine(idleConfig, 'test-agent');
      await idleEngine.init();
      const idleTranscripts = new SessionTranscriptStore(idleEngine.getSessionsDir(), process.cwd());
      const idleRouter = new SessionRouter(idleEngine, idleTranscripts, idleConfig, 'agent-node-123');

      const first = await idleRouter.route({ agentId: 'agent-node-123' });
      await idleEngine.updateSession(first.sessionKey, {
        updatedAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
      });

      const second = await idleRouter.route({ agentId: 'agent-node-123' });

      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.reset).toBe(true);

      await fs.rm(idleConfig.storagePath, { recursive: true, force: true });
    });

    it('forces a reset for the current session key', async () => {
      const first = await router.route({ agentId: 'agent-node-123' });
      const second = await router.resetSession(first.sessionKey);

      expect(second.sessionKey).toBe(first.sessionKey);
      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.reset).toBe(true);
    });

    it('forks to the previous transcript when the transcript is under the token limit', async () => {
      const first = await router.route({ agentId: 'agent-node-123' });
      await router.updateAfterTurn(first.sessionKey, {
        totalTokens: 42,
      });

      const second = await router.resetSession(first.sessionKey);
      const child = SessionManager.open(second.transcriptPath, engine.getSessionsDir(), process.cwd());

      expect(child.getHeader()?.parentSession).toBe(first.transcriptPath);
    });

    it('skips parent session for oversized transcripts', async () => {
      const limitedConfig = makeTempConfig({ parentForkMaxTokens: 10 });
      const limitedEngine = new StorageEngine(limitedConfig, 'test-agent');
      await limitedEngine.init();
      const limitedTranscripts = new SessionTranscriptStore(limitedEngine.getSessionsDir(), process.cwd());
      const limitedRouter = new SessionRouter(limitedEngine, limitedTranscripts, limitedConfig, 'agent-node-123');

      const first = await limitedRouter.route({ agentId: 'agent-node-123' });
      await limitedRouter.updateAfterTurn(first.sessionKey, {
        totalTokens: 100,
      });

      const second = await limitedRouter.resetSession(first.sessionKey);
      const child = SessionManager.open(second.transcriptPath, limitedEngine.getSessionsDir(), process.cwd());

      expect(child.getHeader()?.parentSession).toBeUndefined();

      await fs.rm(limitedConfig.storagePath, { recursive: true, force: true });
    });
  });

  describe('status APIs', () => {
    it('returns session status for an existing key', async () => {
      const routed = await router.route({ agentId: 'agent-node-123' });
      const status = await router.getStatus(routed.sessionKey);

      expect(status?.sessionId).toBe(routed.sessionId);
    });

    it('lists sessions for the agent', async () => {
      await router.route({ agentId: 'agent-node-123' });
      await router.route({ agentId: 'agent-node-123', subKey: 'debug' });

      const sessions = await router.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('updates token counters after a turn', async () => {
      const routed = await router.route({ agentId: 'agent-node-123' });
      await router.updateAfterTurn(routed.sessionKey, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });

      const status = await router.getStatus(routed.sessionKey);
      expect(status?.inputTokens).toBe(100);
      expect(status?.outputTokens).toBe(50);
      expect(status?.totalTokens).toBe(150);
    });
  });
});
