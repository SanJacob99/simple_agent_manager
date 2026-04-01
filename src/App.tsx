import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import FlowCanvas from './canvas/FlowCanvas';
import Sidebar from './panels/Sidebar';
import PropertiesPanel from './panels/PropertiesPanel';
import ChatDrawer from './chat/ChatDrawer';
import SettingsModal from './settings/SettingsModal';
import { useGraphStore } from './store/graph-store';
import { useAgentRuntimeStore } from './store/agent-runtime-store';
import { useSettingsStore } from './settings/settings-store';
import { useModelCatalogStore } from './store/model-catalog-store';

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chatAgentId = useAgentRuntimeStore((s) => s.chatAgentNodeId);
  const closeChatDrawer = useAgentRuntimeStore((s) => s.closeChatDrawer);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const openRouterKey = useSettingsStore((s) => s.apiKeys.openrouter);
  const syncOpenRouterKey = useModelCatalogStore((s) => s.syncOpenRouterKey);

  useEffect(() => {
    void syncOpenRouterKey(openRouterKey);
  }, [openRouterKey, syncOpenRouterKey]);

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
    </div>
  );
}
