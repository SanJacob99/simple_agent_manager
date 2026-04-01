import { create } from 'zustand';

interface AgentRuntimeStore {
  chatAgentNodeId: string | null;
  runningAgentIds: Set<string>;

  openChatDrawer: (nodeId: string) => void;
  closeChatDrawer: () => void;
  setRunning: (nodeId: string, running: boolean) => void;
  isRunning: (nodeId: string) => boolean;
}

export const useAgentRuntimeStore = create<AgentRuntimeStore>((set, get) => ({
  chatAgentNodeId: null,
  runningAgentIds: new Set(),

  openChatDrawer: (nodeId) => {
    set({ chatAgentNodeId: nodeId });
  },

  closeChatDrawer: () => {
    set({ chatAgentNodeId: null });
  },

  setRunning: (nodeId, running) => {
    const ids = new Set(get().runningAgentIds);
    if (running) {
      ids.add(nodeId);
    } else {
      ids.delete(nodeId);
    }
    set({ runningAgentIds: ids });
  },

  isRunning: (nodeId) => {
    return get().runningAgentIds.has(nodeId);
  },
}));
