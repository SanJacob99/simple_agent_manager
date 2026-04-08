import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import FlowCanvas from './canvas/FlowCanvas';
import Sidebar from './panels/Sidebar';
import PropertiesPanel from './panels/PropertiesPanel';
import ChatDrawer from './chat/ChatDrawer';
import AgentNameDialog from './nodes/AgentNameDialog';
import AgentDeleteDialog from './nodes/AgentDeleteDialog';
import { useGraphStore } from './store/graph-store';
import { useAgentConnectionStore } from './store/agent-connection-store';
import { useSettingsStore } from './settings/settings-store';
import { useModelCatalogStore } from './store/model-catalog-store';
import { useSessionStore } from './store/session-store';
import SettingsWorkspace from './settings/SettingsWorkspace';
import type { AppView, SettingsSectionId } from './settings/types';

export default function App() {
  const [appView, setAppView] = useState<AppView>('canvas');
  const [activeSettingsSection, setActiveSettingsSection] =
    useState<SettingsSectionId>('api-keys');
  const chatAgentId = useAgentConnectionStore((s) => s.chatAgentNodeId);
  const closeChatDrawer = useAgentConnectionStore((s) => s.closeChatDrawer);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const openRouterKey = useSettingsStore((s) => s.apiKeys.openrouter);
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const loadFromServer = useSettingsStore((s) => s.loadFromServer);
  const syncOpenRouterKey = useModelCatalogStore((s) => s.syncOpenRouterKey);

  // Load persisted settings from server on mount
  useEffect(() => {
    void loadFromServer();
  }, [loadFromServer]);

  // Agent naming dialog
  const pendingNameNodeId = useGraphStore((s) => s.pendingNameNodeId);
  const setPendingNameNodeId = useGraphStore((s) => s.setPendingNameNodeId);
  const updateNodeData = useGraphStore((s) => s.updateNodeData);
  const removeNode = useGraphStore((s) => s.removeNode);

  // Orphan session pruning
  const pruneOrphanSessions = useSessionStore((s) => s.pruneOrphanSessions);
  const nodes = useGraphStore((s) => s.nodes);

  useEffect(() => {
    void syncOpenRouterKey(openRouterKey);
  }, [openRouterKey, syncOpenRouterKey]);

  // Prune orphan sessions on mount and when graph changes
  useEffect(() => {
    const agentIds = nodes
      .filter((node) => node.data.type === 'agent')
      .map((node) => node.id);
    pruneOrphanSessions(agentIds);
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
      <Sidebar
        appView={appView}
        activeSettingsSection={activeSettingsSection}
        onSettingsSectionChange={setActiveSettingsSection}
      />

      {/* Main Canvas */}
      <div className="relative flex-1">
        {appView === 'canvas' ? (
          <>
            <div className="absolute right-3 top-3 z-10">
              <button
                onClick={() => setAppView('settings')}
                className="rounded-lg bg-slate-800 p-2 text-slate-400 transition hover:bg-slate-700 hover:text-slate-200"
                title="Settings"
              >
                <Settings size={18} />
              </button>
            </div>
            <FlowCanvas />
          </>
        ) : (
          <SettingsWorkspace
            activeSection={activeSettingsSection}
            onExit={() => setAppView('canvas')}
          />
        )}
      </div>

      {/* Right Properties Panel */}
      {appView === 'canvas' && selectedNodeId && !chatAgentId && <PropertiesPanel />}

      {/* Chat Drawer */}
      {appView === 'canvas' && chatAgentId && (
        <ChatDrawer agentNodeId={chatAgentId} onClose={closeChatDrawer} />
      )}

      {/* Agent Naming Dialog */}
      {pendingNameNodeId && (
        <AgentNameDialog
          nodeId={pendingNameNodeId}
          onConfirm={handleNameConfirm}
          onCancel={handleNameCancel}
        />
      )}

      {/* Agent Delete Confirmation Dialog */}
      <AgentDeleteDialog />
    </div>
  );
}
