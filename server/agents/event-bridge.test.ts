import { describe, it, expect, vi } from 'vitest';
import { EventBridge } from './event-bridge';
import type { RunCoordinator } from './run-coordinator';
import type { ServerEvent } from '../../shared/protocol';
import type { CoordinatorEvent } from '../../shared/run-types';

function mockSocket() {
  return {
    readyState: 1,
    send: vi.fn(),
    OPEN: 1,
  } as any;
}

function mockCoordinator(): RunCoordinator & { _listeners: Set<(e: CoordinatorEvent) => void> } {
  const listeners = new Set<(e: CoordinatorEvent) => void>();
  return {
    _listeners: listeners,
    subscribeAll: vi.fn((listener: (e: CoordinatorEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as any;
}

function emitCoordinatorEvent(
  coordinator: ReturnType<typeof mockCoordinator>,
  event: CoordinatorEvent,
) {
  for (const listener of coordinator._listeners) {
    listener(event);
  }
}

describe('EventBridge (coordinator-based)', () => {
  it('maps lifecycle:start to lifecycle:start server event', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('lifecycle:start');
    expect(sent.runId).toBe('run-1');
    expect(sent.agentId).toBe('agent-1');
  });

  it('maps lifecycle:end to both lifecycle:end and agent:end (backwards compat)', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'lifecycle:end',
      runId: 'run-1',
      status: 'ok',
      startedAt: 1000,
      endedAt: 2000,
      payloads: [{ type: 'text', content: 'Hello' }],
    });

    expect(socket.send).toHaveBeenCalledTimes(2);
    const events = socket.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    expect(events.find((e: any) => e.type === 'lifecycle:end')).toBeDefined();
    expect(events.find((e: any) => e.type === 'agent:end')).toBeDefined();
  });

  it('maps lifecycle:error to both lifecycle:error and agent:error (backwards compat)', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'lifecycle:error',
      runId: 'run-1',
      status: 'error',
      error: { code: 'internal', message: 'Something failed', retriable: false },
      startedAt: 1000,
      endedAt: 2000,
    });

    expect(socket.send).toHaveBeenCalledTimes(2);
    const events = socket.send.mock.calls.map((c: any) => JSON.parse(c[0]));
    expect(events.find((e: any) => e.type === 'lifecycle:error')).toBeDefined();
    const agentError = events.find((e: any) => e.type === 'agent:error');
    expect(agentError).toBeDefined();
    expect(agentError.error).toBe('Something failed');
  });

  it('maps stream text_delta events with runId', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'stream',
      runId: 'run-1',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
      },
    });

    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('message:delta');
    expect(sent.delta).toBe('hello');
    expect(sent.runId).toBe('run-1');
  });

  it('does not send to closed sockets', () => {
    const coordinator = mockCoordinator();
    const bridge = new EventBridge('agent-1', coordinator);
    const socket = mockSocket();
    socket.readyState = 3;
    bridge.addSocket(socket);

    emitCoordinatorEvent(coordinator, {
      type: 'lifecycle:start',
      runId: 'run-1',
      agentId: 'agent-1',
      sessionId: 'sess-1',
      startedAt: 1000,
    });

    expect(socket.send).not.toHaveBeenCalled();
  });
});
