import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentClient } from './agent-client';

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  OPEN = MockWebSocket.OPEN;
}

let mockWsInstance: MockWebSocket;

vi.stubGlobal('WebSocket', class extends MockWebSocket {
  constructor() {
    super();
    mockWsInstance = this;
    // Simulate async open
    setTimeout(() => this.onopen?.(), 0);
  }
});

describe('AgentClient', () => {
  let client: AgentClient;

  beforeEach(() => {
    client = new AgentClient('ws://localhost:3210/ws');
  });

  it('connects and reports status', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    expect(client.status).toBe('connected');
  });

  it('sends a command as JSON', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    client.send({ type: 'agent:abort', agentId: 'a1' });
    expect(mockWsInstance.sent).toHaveLength(1);
    expect(JSON.parse(mockWsInstance.sent[0])).toEqual({
      type: 'agent:abort',
      agentId: 'a1',
    });
  });

  it('dispatches incoming events to listeners', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const handler = vi.fn();
    client.onEvent(handler);
    mockWsInstance.onmessage?.({ data: JSON.stringify({ type: 'agent:ready', agentId: 'a1' }) });
    expect(handler).toHaveBeenCalledWith({ type: 'agent:ready', agentId: 'a1' });
  });

  it('unsubscribe removes listener', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));
    const handler = vi.fn();
    const unsub = client.onEvent(handler);
    unsub();
    mockWsInstance.onmessage?.({ data: JSON.stringify({ type: 'agent:end', agentId: 'a1' }) });
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispatches queue events to listeners', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    const handler = vi.fn();
    client.onEvent(handler);

    mockWsInstance.onmessage?.({
      data: JSON.stringify({
        type: 'queue:entered',
        agentId: 'a1',
        runId: 'run-1',
        sessionId: 'sess-1',
        acceptedAt: 1000,
        sessionPosition: 1,
        globalPosition: 2,
      }),
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'queue:entered',
      runId: 'run-1',
    }));
  });

  it('dispatches run:wait:result to listeners', async () => {
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    const handler = vi.fn();
    client.onEvent(handler);

    mockWsInstance.onmessage?.({
      data: JSON.stringify({
        type: 'run:wait:result',
        agentId: 'a1',
        runId: 'run-1',
        status: 'timeout',
        phase: 'pending',
        acceptedAt: 1000,
        payloads: [],
      }),
    });

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run:wait:result',
      phase: 'pending',
    }));
  });
});
