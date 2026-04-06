import { describe, expect, it, vi } from 'vitest';
import { handleConnection } from './ws-handler';

function makeMockSocket() {
  const handlers = new Map<string, (...args: any[]) => void>();

  return {
    send: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
    }),
    async emitMessage(payload: unknown) {
      const handler = handlers.get('message');
      if (!handler) {
        throw new Error('message handler not registered');
      }
      await handler(Buffer.from(JSON.stringify(payload)));
    },
  } as any;
}

describe('ws-handler', () => {
  it('responds to run:wait with run:wait:result', async () => {
    const socket = makeMockSocket();
    const manager = {
      wait: vi.fn(async () => ({
        runId: 'run-1',
        status: 'timeout',
        phase: 'pending',
        acceptedAt: 1000,
        payloads: [],
        queue: { sessionPosition: 1, globalPosition: 1 },
      })),
      removeSocketFromAll: vi.fn(),
    } as any;

    handleConnection(socket, manager, { setAll: vi.fn() } as any);

    await socket.emitMessage({
      type: 'run:wait',
      agentId: 'agent-1',
      runId: 'run-1',
      timeoutMs: 10,
    });

    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('run:wait:result');
    expect(sent.phase).toBe('pending');
    expect(sent.agentId).toBe('agent-1');
  });
});
