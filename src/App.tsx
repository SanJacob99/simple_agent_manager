import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import FlowCanvas from './canvas/FlowCanvas';
import Sidebar from './panels/Sidebar';
import PropertiesPanel from './panels/PropertiesPanel';
import ChatDrawer from './chat/ChatDrawer';
import SettingsModal from './settings/SettingsModal';
import AgentNameDialog from './nodes/AgentNameDialog';
import { useGraphStore } from './store/graph-store';
import { useAgentRuntimeStore } from './store/agent-runtime-store';
import { useSettingsStore } from './settings/settings-store';
import { useModelCatalogStore } from './store/model-catalog-store';
import { useSessionStore } from './store/session-store';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chatAgentId = useAgentRuntimeStore((s) => s.chatAgentNodeId);
  const closeChatDrawer = useAgentRuntimeStore((s) => s.closeChatDrawer);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const openRouterKey = useSettingsStore((s) => s.apiKeys.openrouter);
  const syncOpenRouterKey = useModelCatalogStore((s) => s.syncOpenRouterKey);

  // Agent naming dialog
  const pendingNameNodeId = useGraphStore((s) => s.pendingNameNodeId);
  const setPendingNameNodeId = useGraphStore((s) => s.setPendingNameNodeId);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const removeNode = useGraphStore((s) => s.removeNode);
  const getAgentNames = useGraphStore((s) => s.getAgentNames);

  // Orphan session pruning
  const pruneOrphanSessions = useSessionStore((s) => s.pruneOrphanSessions);
  const nodes = useGraphStore((s) => s.nodes);

  useEffect(() => {
    void syncOpenRouterKey(openRouterKey);
  }, [openRouterKey, syncOpenRouterKey]);

  // Prune orphan sessions on mount and when graph changes
  useEffect(() => {
    const agentNames = getAgentNames();
    pruneOrphanSessions(agentNames);

    // Also clean up old chat-store localStorage key
    try {
      localStorage.removeItem('agent-manager-chats');
    } catch {
      // ignore
    }
  }, [nodes.length]); // Re-prune when nodes change

  const handleNameConfirm = (name: string) => {
    if (!pendingNameNodeId) return;
    updateNodeData(pendingNameNodeId, {
      name,
      nameConfirmed: true,
    });
    setPendingNameNodeId(null);
  };

  const handleNameCancel = () => {
    if (pendingNameNodeId) {
      removeNode(pendingNameNodeId);
    }
    setPendingNameNodeId(null);
  };

  return (
    <div className="flex h-full w-full bg-slate-950">
      {/* Left Sidebar */}
      <Sidebar />

      {/* Main Canvas */}
      <div className="relative flex-1">
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="rounded-lg bg-slate-800 p-2 text-slate-400 transition hover:bg-slate-700 hover:text-slate-200"
            title="Settings"
          >
            <Settings size={18} />
          </button>
        </div>
        <FlowCanvas />
      </div>

      {/* Right Properties Panel */}
      {selectedNodeId && <PropertiesPanel />}

      {/* Chat Drawer */}
      {chatAgentId && (
        <ChatDrawer agentNodeId={chatAgentId} onClose={closeChatDrawer} />
      )}

      {/* Settings Modal */}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}

      {/* Agent Naming Dialog */}
      {pendingNameNodeId && (
        <AgentNameDialog
          nodeId={pendingNameNodeId}
          onConfirm={handleNameConfirm}
          onCancel={handleNameCancel}
        />
      )}
    </div>
  );
}
