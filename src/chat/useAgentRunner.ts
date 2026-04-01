import { useCallback } from 'react';
import { useGraphStore } from '../store/graph-store';
import { useAgentRuntimeStore } from '../store/agent-runtime-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';

export function useAgentRunner() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const openChat = useAgentRuntimeStore((s) => s.openChatDrawer);
  const setRunning = useAgentRuntimeStore((s) => s.setRunning);

  const runAgent = useCallback(
    async (agentNodeId: string) => {
      const config = resolveAgentConfig(agentNodeId, nodes, edges);
      if (!config) {
        console.error('Could not resolve agent config for', agentNodeId);
        return;
      }

      setRunning(agentNodeId, true);
      openChat(agentNodeId);
    },
    [nodes, edges, openChat, setRunning],
  );

  return { runAgent };
}
