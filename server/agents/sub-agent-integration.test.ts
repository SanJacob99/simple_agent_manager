import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import http from 'http';
import { mountSubAgentRoutes } from '../routes/subagents';
import { SubAgentRegistry } from './sub-agent-registry';
import { SubAgentExecutor } from './sub-agent-executor';

async function startServer(
  registry: SubAgentRegistry,
  abort: (id: string) => void = () => {},
) {
  const app = express();
  app.use(express.json());
  mountSubAgentRoutes(app, { registry, abortRun: abort });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Server failed to bind');
  return { server, baseUrl: `http://127.0.0.1:${addr.port}` };
}

describe('sub-agent backend smoke', () => {
  it('spawns, runs to completion, seals the sub-session, returns final text', async () => {
    const registry = new SubAgentRegistry();

    const executor = new SubAgentExecutor({
      runChild: async (opts) => {
        // Simulate a child run that emits a message and completes
        opts.emit({ type: 'message', text: 'I researched and found X.' });
        return { status: 'completed', text: 'I researched and found X.' };
      },
      eventBus: { emit: vi.fn() },
    });

    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:researcher:abc',
        runId: 'cr1',
        subAgentName: 'researcher',
        appliedOverrides: {},
      },
    );

    const result = await executor.dispatch({
      childRunId: 'cr1',
      childSessionKey: 'sub:agent:a:main:researcher:abc',
      syntheticConfig: {} as any,
      message: 'Research X',
      onAbortRegister: () => {},
    });

    expect(result.status).toBe('completed');
    expect(result.text).toContain('researched');

    registry.onComplete('cr1', result.text!);

    expect(registry.get(record.subAgentId)?.status).toBe('completed');
    expect(registry.get(record.subAgentId)?.sealed).toBe(true);
  });

  it('REST kill aborts an in-flight sub and marks killed, not error', async () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a:main', runId: 'pr1' },
      {
        agentId: 'a',
        sessionKey: 'sub:agent:a:main:researcher:abc',
        runId: 'cr1',
        subAgentName: 'researcher',
        appliedOverrides: {},
      },
    );

    let abortFn: () => void = () => {};
    const executor = new SubAgentExecutor({
      runChild: (opts) =>
        new Promise((resolve) => {
          opts.onAbort = () => resolve({ status: 'aborted' });
        }),
      eventBus: { emit: vi.fn() },
    });

    const dispatchP = executor.dispatch({
      childRunId: 'cr1',
      childSessionKey: 'sub:agent:a:main:researcher:abc',
      syntheticConfig: {} as any,
      message: 'Research X',
      onAbortRegister: (fn) => {
        abortFn = fn;
      },
    });

    const { server, baseUrl } = await startServer(registry, () => abortFn());
    try {
      const killRes = await fetch(`${baseUrl}/api/subagents/${record.subAgentId}/kill`, {
        method: 'POST',
      });
      expect(killRes.status).toBe(200);

      // The dispatch should resolve as aborted; registry stays 'killed'.
      const result = await dispatchP;
      expect(result.status).toBe('aborted');
      expect(registry.get(record.subAgentId)?.status).toBe('killed');
    } finally {
      server.close();
    }
  });
});
