import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the agent-client module before importing the store
vi.mock('../client', () => ({
  agentClient: {
    send: vi.fn(),
    onEvent: vi.fn(() => vi.fn()),
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

  it('sendPrompt sends agent:prompt command', () => {
    useAgentConnectionStore.getState().sendPrompt('a1', 'sess-1', 'hello');
    expect(agentClient.send).toHaveBeenCalledWith({
      type: 'agent:prompt',
      agentId: 'a1',
      sessionId: 'sess-1',
      text: 'hello',
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
