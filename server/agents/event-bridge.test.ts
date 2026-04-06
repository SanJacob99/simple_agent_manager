import { describe, it, expect, vi } from 'vitest';
import { EventBridge } from './event-bridge';
import type { StreamProcessor } from './stream-processor';
import type { ServerEvent } from '../../shared/protocol';

function mockSocket() {
  return {
    readyState: 1,
    send: vi.fn(),
    OPEN: 1,
  } as any;
}

function mockProcessor(): StreamProcessor & { _listeners: Set<(e: ServerEvent) => void> } {
  const listeners = new Set<(e: ServerEvent) => void>();
  return {
    _listeners: listeners,
    subscribe: vi.fn((listener: (e: ServerEvent) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  } as any;
}

function emitProcessorEvent(
  processor: ReturnType<typeof mockProcessor>,
  event: ServerEvent,
) {
  for (const listener of processor._listeners) {
    listener(event);
  }
}

describe('EventBridge (StreamProcessor-based)', () => {
  it('broadcasts shaped events to connected sockets', () => {
    const processor = mockProcessor();
    const bridge = new EventBridge('agent-1', processor as any);
    const socket = mockSocket();
    bridge.addSocket(socket);

    emitProcessorEvent(processor, {
      type: 'message:delta',
      agentId: 'agent-1',
      runId: 'run-1',
      delta: 'Hello',
    } as any);

    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('message:delta');
    expect(sent.delta).toBe('Hello');
  });

  it('does not send to closed sockets', () => {
    const processor = mockProcessor();
    const bridge = new EventBridge('agent-1', processor as any);
    const socket = mockSocket();
    socket.readyState = 3; // CLOSED
    bridge.addSocket(socket);

    emitProcessorEvent(processor, {
      type: 'agent:end',
      agentId: 'agent-1',
    });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('removes sockets', () => {
    const processor = mockProcessor();
    const bridge = new EventBridge('agent-1', processor as any);
    const socket = mockSocket();
    bridge.addSocket(socket);
    bridge.removeSocket(socket);

    emitProcessorEvent(processor, {
      type: 'agent:end',
      agentId: 'agent-1',
    });

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('cleans up on destroy', () => {
    const processor = mockProcessor();
    const bridge = new EventBridge('agent-1', processor as any);
    bridge.addSocket(mockSocket());
    bridge.destroy();

    expect(bridge.socketCount).toBe(0);
  });
});
