import { describe, it, expect, vi } from 'vitest';
import { EventBridge } from './event-bridge';
import type { ServerEvent } from '../../shared/protocol';

// Minimal mock WebSocket
function mockSocket() {
  return {
    readyState: 1, // OPEN
    send: vi.fn(),
    OPEN: 1,
  } as any;
}

describe('EventBridge', () => {
  it('forwards a runtime event to connected sockets as a ServerEvent', () => {
    const bridge = new EventBridge('agent-1');
    const socket = mockSocket();
    bridge.addSocket(socket);

    bridge.handleRuntimeEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: 'hello' },
    } as any);

    expect(socket.send).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(socket.send.mock.calls[0][0]) as ServerEvent;
    expect(sent.type).toBe('message:delta');
    expect((sent as any).agentId).toBe('agent-1');
    expect((sent as any).delta).toBe('hello');
  });

  it('does not send to closed sockets', () => {
    const bridge = new EventBridge('agent-1');
    const socket = mockSocket();
    socket.readyState = 3; // CLOSED
    bridge.addSocket(socket);

    bridge.handleRuntimeEvent({
      type: 'agent_end',
    } as any);

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('removeSocket stops sending', () => {
    const bridge = new EventBridge('agent-1');
    const socket = mockSocket();
    bridge.addSocket(socket);
    bridge.removeSocket(socket);

    bridge.handleRuntimeEvent({ type: 'agent_end' } as any);

    expect(socket.send).not.toHaveBeenCalled();
  });

  it('maps runtime_error to agent:error', () => {
    const bridge = new EventBridge('agent-1');
    const socket = mockSocket();
    bridge.addSocket(socket);

    bridge.handleRuntimeEvent({
      type: 'runtime_error',
      error: 'Something failed',
    } as any);

    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('agent:error');
    expect(sent.error).toBe('Something failed');
  });

  it('maps agent_end to agent:end', () => {
    const bridge = new EventBridge('agent-1');
    const socket = mockSocket();
    bridge.addSocket(socket);

    bridge.handleRuntimeEvent({ type: 'agent_end' } as any);

    const sent = JSON.parse(socket.send.mock.calls[0][0]);
    expect(sent.type).toBe('agent:end');
    expect(sent.agentId).toBe('agent-1');
  });
});
