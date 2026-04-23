import { create } from 'zustand';
import { agentClient } from '../client';
import type { AgentConfig } from '../../shared/agent-config';
import type { ImageAttachment, ServerEvent } from '../../shared/protocol';
import type { McpConnectionStatus } from '../types/nodes';

export type AgentStatus = 'connecting' | 'idle' | 'running' | 'error' | 'disconnected';

interface AgentState {
  status: AgentStatus;
}

interface McpState {
  status: McpConnectionStatus;
  error?: string;
}

interface AgentConnectionStore {
  agents: Record<string, AgentState>;
  /** Keyed by MCP node id. Server pushes updates via `mcp:status` events. */
  mcps: Record<string, McpState>;
  connectionStatus: 'connecting' | 'connected' | 'disconnected';
  hasConnectedOnce: boolean;
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected') => void;
  getMcpState: (mcpNodeId: string) => McpState;

  // Chat drawer UI state
  chatAgentNodeId: string | null;
  openChatDrawer: (agentId: string) => void;
  closeChatDrawer: () => void;

  // Actions
  startAgent: (agentId: string, config: AgentConfig) => Promise<void>;
  sendPrompt: (
    agentId: string,
    sessionKey: string,
    text: string,
    attachments?: ImageAttachment[],
  ) => Promise<void>;
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

function createDeferred() {
  let resolve!: () => void;
  let reject!: (error?: unknown) => void;
  const rawPromise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const promise = rawPromise.catch(() => undefined);
  return { rawPromise, promise, resolve, reject };
}

const pendingStarts = new Map<
  string,
  ReturnType<typeof createDeferred>
>();

export const useAgentConnectionStore = create<AgentConnectionStore>((set, get) => ({
  agents: {},
  mcps: {},

  chatAgentNodeId: null,
  openChatDrawer: (agentId) => set({ chatAgentNodeId: agentId }),
  closeChatDrawer: () => set({ chatAgentNodeId: null }),

  startAgent: async (agentId, config) => {
    const existing = pendingStarts.get(agentId);
    if (existing) {
      return existing.promise;
    }

    const deferred = createDeferred();
    pendingStarts.set(agentId, deferred);

    set((state) => ({
      agents: {
        ...state.agents,
        [agentId]: { status: 'connecting' },
      },
    }));
    agentClient.trackAgent(agentId);
    agentClient.send({ type: 'agent:start', agentId, config });
    return deferred.promise;
  },

  sendPrompt: async (agentId, sessionKey, text, attachments) => {
    const pendingStart = pendingStarts.get(agentId);
    if (pendingStart) {
      await pendingStart.rawPromise;
    }
    agentClient.send({ type: 'agent:dispatch', agentId, sessionKey, text, attachments });
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
    pendingStarts.get(agentId)?.reject(new Error(`Agent ${agentId} destroyed before ready`));
    pendingStarts.delete(agentId);
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
        pendingStarts.get(agentId)?.resolve();
        pendingStarts.delete(agentId);
        set((state) => ({
          agents: {
            ...state.agents,
            [agentId]: { status: 'idle' },
          },
        }));
        break;

      case 'agent:error':
        pendingStarts.get(agentId)?.reject(new Error(event.error));
        pendingStarts.delete(agentId);
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

      case 'mcp:status':
        set((state) => ({
          mcps: {
            ...state.mcps,
            [event.mcpNodeId]: { status: event.status, error: event.error },
          },
        }));
        break;
    }
  },

  getAgentStatus: (agentId) => {
    return get().agents[agentId]?.status ?? 'disconnected';
  },

  getMcpState: (mcpNodeId) => {
    return get().mcps[mcpNodeId] ?? { status: 'unknown' };
  },

  connectionStatus: agentClient.status,
  hasConnectedOnce: agentClient.status === 'connected',
  setConnectionStatus: (status: 'connecting' | 'connected' | 'disconnected') =>
    set((state) => ({
      connectionStatus: status,
      hasConnectedOnce: state.hasConnectedOnce || status === 'connected',
    })),

  reset: () => {
    for (const pending of pendingStarts.values()) {
      pending.reject(new Error('Agent connection store reset'));
    }
    pendingStarts.clear();
    set({
      agents: {},
      mcps: {},
      chatAgentNodeId: null,
      connectionStatus: 'disconnected',
      hasConnectedOnce: false,
    });
  },
}));

// Wire up AgentClient events to the store
agentClient.onEvent((event) => {
  useAgentConnectionStore.getState().handleEvent(event);
});

agentClient.onStatusChange((status) => {
  useAgentConnectionStore.getState().setConnectionStatus(status);
});
