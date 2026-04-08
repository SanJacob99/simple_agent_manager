import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agent-client module before importing the store
vi.mock('../client', () => ({
  agentClient: {
    send: vi.fn(),
    onEvent: vi.fn(() => vi.fn()),
    onStatusChange: vi.fn(() => vi.fn()),
    trackAgent: vi.fn(),
    untrackAgent: vi.fn(),
  },
}));

import { useAgentConnectionStore } from './agent-connection-store';
import { agentClient } from '../client';

describe('AgentConnectionStore', () => {
  beforeEach(() => {
    useAgentConnectionStore.getState().reset();
    vi.clearAllMocks();
  });

  it('startAgent sends agent:start command', () => {
    const config = { id: 'a1', name: 'Test' } as any;
    useAgentConnectionStore.getState().startAgent('a1', config);
    expect(agentClient.send).toHaveBeenCalledWith({
      type: 'agent:start',
      agentId: 'a1',
      config,
    });
  });

  it('sendPrompt sends agent:dispatch command', () => {
    useAgentConnectionStore.getState().sendPrompt('a1', 'sess-1', 'hello');
    expect(agentClient.send).toHaveBeenCalledWith({
      type: 'agent:dispatch',
      agentId: 'a1',
      sessionKey: 'sess-1',
      text: 'hello',
    });
  });

  it('waits for agent readiness before sending a prompt after start', async () => {
    const store = useAgentConnectionStore.getState();
    const config = { id: 'a1', name: 'Test' } as any;

    store.startAgent('a1', config);
    const promptPromise = store.sendPrompt('a1', 'sess-1', 'hello');

    expect(agentClient.send).toHaveBeenCalledTimes(1);
    expect(agentClient.send).toHaveBeenNthCalledWith(1, {
      type: 'agent:start',
      agentId: 'a1',
      config,
    });

    store.handleEvent({ type: 'agent:ready', agentId: 'a1' });
    await promptPromise;

    expect(agentClient.send).toHaveBeenCalledTimes(2);
    expect(agentClient.send).toHaveBeenNthCalledWith(2, {
      type: 'agent:dispatch',
      agentId: 'a1',
      sessionKey: 'sess-1',
      text: 'hello',
      attachments: undefined,
    });
  });

  it('tracks agent status from events', () => {
    const store = useAgentConnectionStore.getState();
    store.handleEvent({ type: 'agent:ready', agentId: 'a1' });
    expect(store.getAgentStatus('a1')).toBe('idle');
  });

  it('tracks running status during prompt', () => {
    const store = useAgentConnectionStore.getState();
    store.handleEvent({ type: 'message:start', agentId: 'a1', message: { role: 'assistant' } });
    expect(store.getAgentStatus('a1')).toBe('running');
  });

  it('returns to idle after agent:end', () => {
    const store = useAgentConnectionStore.getState();
    store.handleEvent({ type: 'message:start', agentId: 'a1', message: { role: 'assistant' } });
    store.handleEvent({ type: 'agent:end', agentId: 'a1' });
    expect(store.getAgentStatus('a1')).toBe('idle');
  });

  it('destroyAgent removes agent and sends command', () => {
    const store = useAgentConnectionStore.getState();
    store.handleEvent({ type: 'agent:ready', agentId: 'a1' });
    store.destroyAgent('a1');
    expect(agentClient.send).toHaveBeenCalledWith({
      type: 'agent:destroy',
      agentId: 'a1',
    });
    expect(store.getAgentStatus('a1')).toBe('disconnected');
  });
});
