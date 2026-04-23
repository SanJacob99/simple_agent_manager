import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentManager } from './agent-manager';
import { ApiKeyStore } from '../auth/api-keys';
import { loadEnvFile } from '../test-support/load-env-file';
import type { AgentConfig } from '../../shared/agent-config';

const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini';

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

  it(
    'reads OPENROUTER_API_KEY from .env and completes a live run',
    async () => {
      loadEnvFile();

      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error(
          'OPENROUTER_API_KEY is required in the environment or .env to run npm run test:openrouter',
        );
      }

      const modelId = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
      const storagePath = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-openrouter-'));
      tempDirs.push(storagePath);

      const apiKeys = new ApiKeyStore();
      apiKeys.setAll({ openrouter: apiKey });

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
});
