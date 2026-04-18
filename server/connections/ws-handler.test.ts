import { describe, expect, it, vi } from 'vitest';
import { handleConnection } from './ws-handler';

vi.mock('../logger');

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
    emitMessageWithoutWaiting(payload: unknown) {
      const handler = handlers.get('message');
      if (!handler) {
        throw new Error('message handler not registered');
      }
      return handler(Buffer.from(JSON.stringify(payload)));
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

  it('waits for an in-flight agent:start before dispatching a prompt', async () => {
    const socket = makeMockSocket();
    let resolveStart!: () => void;
    let started = false;
    const startPromise = new Promise<void>((resolve) => {
      resolveStart = () => {
        started = true;
        resolve();
      };
    });

    const manager = {
      start: vi.fn(async () => startPromise),
      addSocket: vi.fn(),
      dispatch: vi.fn(async () => {
        if (!started) {
          throw new Error('Agent node_IvAHkFQwrG not found');
        }
        return {
          runId: 'run-1',
          sessionId: 'sess-1',
          acceptedAt: 1000,
        };
      }),
      removeSocketFromAll: vi.fn(),
      getBridge: vi.fn(() => ({ broadcast: vi.fn() })),
      hitlRegistry: {
        resolveForSession: vi.fn(() => null),
        listForSession: vi.fn(() => []),
        resolve: vi.fn(() => true),
      },
    } as any;

    handleConnection(socket, manager, { setAll: vi.fn() } as any);

    const startCommand = socket.emitMessageWithoutWaiting({
      type: 'agent:start',
      agentId: 'node_IvAHkFQwrG',
      config: { id: 'node_IvAHkFQwrG' },
    });
    const promptCommand = socket.emitMessageWithoutWaiting({
      type: 'agent:prompt',
      agentId: 'node_IvAHkFQwrG',
      sessionId: 'sess-1',
      text: 'Hello',
    });

    await Promise.resolve();
    expect(manager.dispatch).not.toHaveBeenCalled();

    resolveStart();
    await Promise.all([startCommand, promptCommand]);

    expect(manager.dispatch).toHaveBeenCalledWith('node_IvAHkFQwrG', {
      sessionKey: 'sess-1',
      text: 'Hello',
      attachments: undefined,
    });

    const sentEvents = socket.send.mock.calls.map(([payload]: [string]) => JSON.parse(payload));
    expect(sentEvents).toEqual([
      { type: 'agent:ready', agentId: 'node_IvAHkFQwrG' },
      {
        type: 'run:accepted',
        agentId: 'node_IvAHkFQwrG',
        runId: 'run-1',
        sessionId: 'sess-1',
        acceptedAt: 1000,
      },
    ]);
  });
});
