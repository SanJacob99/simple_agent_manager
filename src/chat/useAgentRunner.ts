import { useCallback } from 'react';
import { useGraphStore } from '../store/graph-store';
import { useAgentRuntimeStore } from '../store/agent-runtime-store';
import { useSettingsStore } from '../settings/settings-store';
import { resolveAgentConfig } from '../utils/graph-to-agent';

export function useAgentRunner() {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const openChat = useAgentRuntimeStore((s) => s.openChatDrawer);
  const getOrCreateRuntime = useAgentRuntimeStore((s) => s.getOrCreateRuntime);
  const getApiKey = useSettingsStore((s) => s.getApiKey);

  const runAgent = useCallback(
    (agentNodeId: string) => {
      const config = resolveAgentConfig(agentNodeId, nodes, edges);
      if (!config) {
        console.error('Could not resolve agent config for', agentNodeId);
        return;
      }

      // Pre-create the runtime so it's ready when ChatDrawer opens
      getOrCreateRuntime(agentNodeId, config, (provider) =>
        Promise.resolve(getApiKey(provider)),
      );
      openChat(agentNodeId);
    },
    [nodes, edges, openChat, getOrCreateRuntime, getApiKey],
  );

  return { runAgent };
}
