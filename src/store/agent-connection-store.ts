import { create } from 'zustand';
import { agentClient } from '../client';
import type { AgentConfig } from '../../shared/agent-config';
import type { ServerEvent } from '../../shared/protocol';

export type AgentStatus = 'connecting' | 'idle' | 'running' | 'error' | 'disconnected';

interface AgentState {
  status: AgentStatus;
}

interface AgentConnectionStore {
  agents: Record<string, AgentState>;

  // Chat drawer UI state
  chatAgentNodeId: string | null;
  openChatDrawer: (agentId: string) => void;
  closeChatDrawer: () => void;

  // Actions
  startAgent: (agentId: string, config: AgentConfig) => void;
  sendPrompt: (agentId: string, sessionId: string, text: string) => void;
  abortAgent: (agentId: string) => void;
  destroyAgent: (agentId: string) => void;
  syncAgent: (agentId: string) => void;
  sendApiKeys: (keys: Record<string, string>) => void;

  // Event handling
  handleEvent: (event: ServerEvent) => void;

  // Queries
  getAgentStatus: (agentId: string) => AgentStatus;

  // Reset (for testing)
  reset: () => void;
}

export const useAgentConnectionStore = create<AgentConnectionStore>((set, get) => ({
  agents: {},

  chatAgentNodeId: null,
  openChatDrawer: (agentId) => set({ chatAgentNodeId: agentId }),
  closeChatDrawer: () => set({ chatAgentNodeId: null }),

  startAgent: (agentId, config) => {
    set((state) => ({
      agents: {
        ...state.agents,
        [agentId]: { status: 'connecting' },
      },
    }));
    agentClient.trackAgent(agentId);
    agentClient.send({ type: 'agent:start', agentId, config });
  },

  sendPrompt: (agentId, sessionId, text) => {
    agentClient.send({ type: 'agent:prompt', agentId, sessionId, text });
  },

  abortAgent: (agentId) => {
    agentClient.send({ type: 'agent:abort', agentId });
    set((state) => ({
      agents: {
        ...state.agents,
        [agentId]: { ...state.agents[agentId], status: 'idle' },
      },
    }));
  },

  destroyAgent: (agentId) => {
    agentClient.send({ type: 'agent:destroy', agentId });
    agentClient.untrackAgent(agentId);
    set((state) => {
      const { [agentId]: _, ...rest } = state.agents;
      return { agents: rest };
    });
  },

  syncAgent: (agentId) => {
    agentClient.trackAgent(agentId);
    agentClient.send({ type: 'agent:sync', agentId });
  },

  sendApiKeys: (keys) => {
    agentClient.send({ type: 'config:setApiKeys', keys });
  },

  handleEvent: (event) => {
    const agentId = 'agentId' in event ? event.agentId : null;
    if (!agentId) return;

    switch (event.type) {
      case 'agent:ready':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: 'idle' },
          },
        }));
        break;

      case 'agent:error':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: 'error' },
          },
        }));
        break;

      case 'message:start':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: 'running' },
          },
        }));
        break;

      case 'agent:end':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: 'idle' },
          },
        }));
        break;

      case 'agent:state':
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: event.status === 'not_found' ? 'disconnected' : event.status },
          },
        }));
        break;
    }
  },

  getAgentStatus: (agentId) => {
    return get().agents[agentId]?.status ?? 'disconnected';
  },

  reset: () => {
    set({ agents: {}, chatAgentNodeId: null });
  },
}));

// Wire up AgentClient events to the store
agentClient.onEvent((event) => {
  useAgentConnectionStore.getState().handleEvent(event);
});
