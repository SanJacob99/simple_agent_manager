import { create } from 'zustand';
import { AgentRuntime } from '../runtime/agent-runtime';
import type { AgentConfig } from '../runtime/agent-config';

interface AgentRuntimeStore {
  chatAgentNodeId: string | null;
  runningAgentIds: Set<string>;
  runtimes: Map<string, AgentRuntime>;

  openChatDrawer: (nodeId: string) => void;
  closeChatDrawer: () => void;
  setRunning: (nodeId: string, running: boolean) => void;
  isRunning: (nodeId: string) => boolean;
  getOrCreateRuntime: (
    nodeId: string,
    config: AgentConfig,
    getApiKey: (provider: string) => Promise<string | undefined> | string | undefined,
  ) => AgentRuntime;
  destroyRuntime: (nodeId: string) => void;
}

export const useAgentRuntimeStore = create<AgentRuntimeStore>((set, get) => ({
  chatAgentNodeId: null,
  runningAgentIds: new Set(),
  runtimes: new Map(),

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

  getOrCreateRuntime: (nodeId, config, getApiKey) => {
    const existing = get().runtimes.get(nodeId);
    if (existing) return existing;

    const runtime = new AgentRuntime(config, getApiKey);
    const runtimes = new Map(get().runtimes);
    runtimes.set(nodeId, runtime);
    set({ runtimes });
    return runtime;
  },

  destroyRuntime: (nodeId) => {
    const runtime = get().runtimes.get(nodeId);
    if (runtime) {
      runtime.destroy();
      const runtimes = new Map(get().runtimes);
      runtimes.delete(nodeId);
      set({ runtimes });
    }
  },
}));
