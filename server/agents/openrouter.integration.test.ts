import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentManager } from './agent-manager';
import { ApiKeyStore } from '../auth/api-keys';
import { loadEnvFile } from '../test-support/load-env-file';
import type { AgentConfig } from '../../shared/agent-config';

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';
await loadEnvFile();
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const openrouterIt = OPENROUTER_API_KEY ? it : it.skip;

function makeConfig(storagePath: string, modelId: string): AgentConfig {
  return {
    id: 'openrouter-live-agent',
    version: 3,
    name: 'OpenRouter Live Agent',
    description: 'Real OpenRouter integration test agent',
    tags: ['integration', 'openrouter'],
    provider: 'openrouter',
    modelId,
    thinkingLevel: 'none',
    systemPrompt: {
      mode: 'manual',
      sections: [
        {
          key: 'manual',
          label: 'Manual Prompt',
          content: 'Reply briefly and directly.',
          tokenEstimate: 4,
        },
      ],
      assembled: 'Reply briefly and directly.',
      userInstructions: 'Reply briefly and directly.',
    },
    modelCapabilities: {},
    memory: null,
    tools: null,
    contextEngine: {
      tokenBudget: 16_000,
      reservedForResponse: 2_000,
      compactionStrategy: 'sliding-window',
      compactionTrigger: 'auto',
      compactionThreshold: 0.8,
      autoFlushBeforeCompact: false,
      ragEnabled: false,
      ragTopK: 5,
      ragMinScore: 0,
    },
    connectors: [],
    agentComm: [],
    storage: {
      label: 'Integration Storage',
      backendType: 'filesystem',
      storagePath,
      sessionRetention: 5,
      memoryEnabled: false,
      dailyMemoryEnabled: false,
      dailyResetEnabled: true,
      dailyResetHour: 4,
      idleResetEnabled: false,
      idleResetMinutes: 60,
      parentForkMaxTokens: 100000,
    },
    vectorDatabases: [],
    exportedAt: Date.now(),
    sourceGraphId: 'openrouter-live-agent',
    runTimeoutMs: 90_000,
    showReasoning: false,
    verbose: false,
  };
}

describe('OpenRouter live integration', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  openrouterIt(
    'reads OPENROUTER_API_KEY from .env and completes a live run',
    async () => {
      const modelId = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
      const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-openrouter-'));
      tempDirs.push(storagePath);

      const apiKeys = new ApiKeyStore();
      apiKeys.setAll({ openrouter: OPENROUTER_API_KEY! });

      const manager = new AgentManager(apiKeys);

      try {
        await manager.start(makeConfig(storagePath, modelId));

        const { runId } = await manager.dispatch('openrouter-live-agent', {
          sessionKey: 'openrouter-live-session',
          text: 'Reply with a short greeting.',
          timeoutMs: 90_000,
        });

        const result = await manager.wait('openrouter-live-agent', runId, 95_000);
        expect(result.status).toBe('ok');

        const textPayload = result.payloads.find((payload) => payload.type === 'text');
        expect(textPayload).toBeDefined();
        expect(textPayload?.content.trim().length).toBeGreaterThan(0);
      } finally {
        await manager.shutdown();
      }
    },
    120_000,
  );

  openrouterIt(
    'passes an end-to-end quality check for instruction fidelity',
    async () => {
      const modelId = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
      const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-openrouter-quality-'));
      tempDirs.push(storagePath);

      const apiKeys = new ApiKeyStore();
      apiKeys.setAll({ openrouter: OPENROUTER_API_KEY! });

      const manager = new AgentManager(apiKeys);

      try {
        await manager.start(makeConfig(storagePath, modelId));

        const { runId } = await manager.dispatch('openrouter-live-agent', {
          sessionKey: 'openrouter-quality-session',
          text: [
            'Return only minified JSON (no markdown).',
            'Transform the phrase "simple agent manager".',
            'Schema: {"uppercase":"...", "wordCount":number}.',
            'Rules: uppercase must be exactly "SIMPLE AGENT MANAGER" and wordCount must be 3.',
          ].join(' '),
          timeoutMs: 90_000,
        });

        const result = await manager.wait('openrouter-live-agent', runId, 95_000);
        expect(result.status).toBe('ok');

        const textPayload = result.payloads.find((payload) => payload.type === 'text');
        expect(textPayload).toBeDefined();
        const raw = textPayload?.content.trim() ?? '';
        expect(raw.length).toBeGreaterThan(0);

        let parsed: { uppercase?: unknown; wordCount?: unknown };
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error(`Expected JSON-only response, got: ${raw}`);
        }

        expect(parsed.uppercase).toBe('SIMPLE AGENT MANAGER');
        expect(parsed.wordCount).toBe(3);
      } finally {
        await manager.shutdown();
      }
    },
    120_000,
  );
});
