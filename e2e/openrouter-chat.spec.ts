import { test, expect } from '@playwright/test';
import path from 'path';
import { loadEnvFile } from '../server/test-support/load-env-file';

type TraceEntry = {
  at: number;
  kind: string;
  detail?: string;
};

declare global {
  interface Window {
    __samTrace?: TraceEntry[];
  }
}

const envPath = path.resolve(process.cwd(), '.env');
loadEnvFile(envPath);

const openRouterApiKey = process.env.OPENROUTER_API_KEY?.trim();
const openRouterModel = process.env.OPENROUTER_MODEL?.trim() || 'qwen/qwen3.6-plus:free';
const expectedReply = 'OPENROUTER_UI_E2E_OK';

function buildGraph(agentName: string, storagePath: string, modelId: string) {
  return {
    id: 'default',
    version: 2,
    updatedAt: Date.now(),
    graph: {
      nodes: [
        {
          id: 'agent-e2e',
          type: 'agent',
          position: { x: 500, y: 250 },
          data: {
            type: 'agent',
            name: agentName,
            nameConfirmed: true,
            systemPrompt: 'You are a concise assistant. Follow the user exactly.',
            systemPromptMode: 'append',
            provider: 'openrouter',
            modelId,
            thinkingLevel: 'off',
            description: 'Live browser E2E agent',
            tags: ['e2e', 'openrouter'],
          },
        },
        {
          id: 'context-e2e',
          type: 'contextEngine',
          position: { x: 160, y: 260 },
          data: {
            type: 'contextEngine',
            label: 'E2E Context',
            tokenBudget: 128000,
            reservedForResponse: 4096,
            ownsCompaction: false,
            compactionStrategy: 'hybrid',
            compactionTrigger: 'auto',
            compactionThreshold: 0.8,
            bootstrapMaxChars: 20000,
            bootstrapTotalMaxChars: 150000,
            autoFlushBeforeCompact: true,
            ragEnabled: false,
            ragTopK: 5,
            ragMinScore: 0.7,
          },
        },
        {
          id: 'storage-e2e',
          type: 'storage',
          position: { x: 160, y: 420 },
          data: {
            type: 'storage',
            label: 'E2E Storage',
            backendType: 'filesystem',
            storagePath,
            sessionRetention: 50,
            memoryEnabled: true,
            dailyMemoryEnabled: true,
          },
        },
      ],
      edges: [
        {
          id: 'edge_context-e2e_agent-e2e',
          source: 'context-e2e',
          target: 'agent-e2e',
          type: 'data',
          animated: true,
        },
        {
          id: 'edge_storage-e2e_agent-e2e',
          source: 'storage-e2e',
          target: 'agent-e2e',
          type: 'data',
          animated: true,
        },
      ],
    },
  };
}

function buildSettings(apiKey: string) {
  return {
    apiKeys: {
      openrouter: apiKey,
    },
    agentDefaults: {
      provider: 'openrouter',
      thinkingLevel: 'off',
    },
  };
}

test.describe('OpenRouter live browser E2E', () => {
  test.beforeAll(() => {
    if (!openRouterApiKey) {
      throw new Error(
        `OPENROUTER_API_KEY is required in the environment or ${envPath} for npm run test:e2e:openrouter.`,
      );
    }
  });

  test('sends a real UI message and renders the live reply with a captured trace', async ({ page }, testInfo) => {
    const browserConsole: string[] = [];
    const runStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agentName = `OpenRouter E2E Agent ${runStamp}`;
    const storagePath = `./.tmp/openrouter-e2e-${runStamp}`;

    page.on('console', (message) => {
      browserConsole.push(`[${message.type()}] ${message.text()}`);
    });

    await page.addInitScript(
      ({ graph, settings }) => {
        const trace: TraceEntry[] = [];
        const record = (kind: string, detail?: string) => {
          trace.push({
            at: Date.now(),
            kind,
            detail,
          });
        };

        const safeDetail = (value: unknown) => {
          try {
            return JSON.stringify(value);
          } catch {
            return String(value);
          }
        };

        const recordSocketPayloadTypes = (prefix: 'ws:send:event' | 'ws:receive:event', payload: unknown) => {
          if (!payload || typeof payload !== 'object') {
            return;
          }

          if (Array.isArray(payload)) {
            for (const item of payload) {
              recordSocketPayloadTypes(prefix, item);
            }
            return;
          }

          if ('type' in payload && typeof payload.type === 'string') {
            record(prefix, payload.type);
          }
        };

        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...args) => {
          const [input, init] = args;
          const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
          const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
          record('fetch:start', `${method} ${url}`);

          try {
            const response = await originalFetch(...args);
            record('fetch:end', `${response.status} ${method} ${url}`);
            return response;
          } catch (error) {
            record('fetch:error', `${method} ${url} ${(error as Error).message}`);
            throw error;
          }
        };

        const OriginalWebSocket = window.WebSocket;
        class TracedWebSocket extends OriginalWebSocket {
          constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            record('ws:create', String(url));
            this.addEventListener('open', () => record('ws:open', String(url)));
            this.addEventListener('close', (event) => record('ws:close', `${event.code}:${event.reason}`));
            this.addEventListener('error', () => record('ws:error', String(url)));
            this.addEventListener('message', (event) => {
              const detail = typeof event.data === 'string' ? event.data : safeDetail(event.data);
              record('ws:receive', detail);
              if (typeof event.data === 'string') {
                try {
                  recordSocketPayloadTypes('ws:receive:event', JSON.parse(event.data));
                } catch {
                  // Keep the raw payload in the trace when parsing fails.
                }
              }
            });
          }

          send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
            const detail = typeof data === 'string' ? data : `[binary:${typeof data}]`;
            record('ws:send', detail);
            if (typeof data === 'string') {
              try {
                recordSocketPayloadTypes('ws:send:event', JSON.parse(data));
              } catch {
                // Keep the raw payload in the trace when parsing fails.
              }
            }
            return super.send(data);
          }
        }

        window.WebSocket = TracedWebSocket as typeof WebSocket;
        window.__samTrace = trace;
        localStorage.setItem('agent-manager-settings', JSON.stringify(settings));
        record('seed:settings', 'agent-manager-settings');
        localStorage.setItem('agent-manager-graph', JSON.stringify(graph));
        record('seed:graph', 'agent-manager-graph');
      },
      {
        graph: buildGraph(agentName, storagePath, openRouterModel),
        settings: buildSettings(openRouterApiKey!),
      },
    );

    const startedAt = Date.now();

    try {
      await page.goto('/');
      await page.waitForFunction(() => window.__samTrace?.some((entry) => entry.kind === 'ws:open'));

      await expect(page.getByTitle('Open Chat')).toBeVisible();
      await page.getByTitle('Open Chat').click();

      const input = page.getByPlaceholder('Type a message...');
      await expect(input).toBeVisible();

      await input.fill(`Reply with exactly ${expectedReply} and nothing else.`);
      await page.getByTitle('Send Message').click();

      const assistantReply = page.locator('div.justify-start').filter({ hasText: expectedReply }).last();
      await expect(assistantReply).toBeVisible({ timeout: 90_000 });

      const trace = await page.evaluate(() => window.__samTrace ?? []);
      const traceKinds = trace.map((entry) => entry.kind);

      expect(traceKinds).toContain('seed:settings');
      expect(traceKinds).toContain('seed:graph');
      expect(traceKinds).toContain('ws:open');
      expect(trace.some((entry) => entry.kind === 'fetch:start' && entry.detail?.includes('/api/storage/init'))).toBe(true);
      expect(trace.some((entry) => entry.kind === 'ws:send:event' && entry.detail === 'config:setApiKeys')).toBe(true);
      expect(trace.some((entry) => entry.kind === 'ws:send:event' && entry.detail === 'agent:start')).toBe(true);
      expect(trace.some((entry) => entry.kind === 'ws:send:event' && entry.detail === 'agent:prompt')).toBe(true);
      expect(trace.some((entry) => entry.kind === 'ws:receive:event' && entry.detail === 'message:start')).toBe(true);
      expect(trace.some((entry) => entry.kind === 'ws:receive:event' && entry.detail === 'message:delta')).toBe(true);
      expect(trace.some((entry) => entry.kind === 'ws:receive:event' && entry.detail === 'message:end')).toBe(true);
    } finally {
      const trace = await page.evaluate(() => window.__samTrace ?? []);
      const normalizedTrace = trace
        .filter((entry) => entry.at >= startedAt)
        .map((entry) => ({
          ...entry,
          offsetMs: entry.at - startedAt,
        }));

      await testInfo.attach('openrouter-ui-trace', {
        body: JSON.stringify(normalizedTrace, null, 2),
        contentType: 'application/json',
      });

      await testInfo.attach('browser-console', {
        body: browserConsole.join('\n') || '(no browser console output)',
        contentType: 'text/plain',
      });

      if (testInfo.status !== testInfo.expectedStatus) {
        console.error('OpenRouter UI trace:\n' + JSON.stringify(normalizedTrace, null, 2));
        console.error('Browser console:\n' + (browserConsole.join('\n') || '(no browser console output)'));
      }
    }
  });
});
