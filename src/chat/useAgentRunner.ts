import { useCallback } from 'react';
import { useAgentConnectionStore } from '../store/agent-connection-store';

export function useAgentRunner() {
  const openChat = useAgentConnectionStore((s) => s.openChatDrawer);

  const runAgent = useCallback(
    (agentNodeId: string) => {
      openChat(agentNodeId);
    },
    [openChat],
  );

  return { runAgent };
}
