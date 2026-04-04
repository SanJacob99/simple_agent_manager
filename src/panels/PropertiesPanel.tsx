import { X, Trash2 } from 'lucide-react';
import { useGraphStore } from '../store/graph-store';
import { NODE_COLORS, NODE_LABELS } from '../utils/theme';
import AgentProperties from './property-editors/AgentProperties';
import MemoryProperties from './property-editors/MemoryProperties';
import ToolsProperties from './property-editors/ToolsProperties';
import SkillsProperties from './property-editors/SkillsProperties';
import ContextEngineProperties from './property-editors/ContextEngineProperties';
import AgentCommProperties from './property-editors/AgentCommProperties';
import ConnectorsProperties from './property-editors/ConnectorsProperties';
import StorageProperties from './property-editors/StorageProperties';
import VectorDatabaseProperties from './property-editors/VectorDatabaseProperties';
import type { FlowNodeData } from '../types/nodes';

function PropertyEditorForType({ nodeId, data }: { nodeId: string; data: FlowNodeData }) {
  switch (data.type) {
    case 'agent':
      return <AgentProperties nodeId={nodeId} data={data} />;
    case 'memory':
      return <MemoryProperties nodeId={nodeId} data={data} />;
    case 'tools':
      return <ToolsProperties nodeId={nodeId} data={data} />;
    case 'skills':
      return <SkillsProperties nodeId={nodeId} data={data} />;
    case 'contextEngine':
      return <ContextEngineProperties nodeId={nodeId} data={data} />;
    case 'agentComm':
      return <AgentCommProperties nodeId={nodeId} data={data} />;
    case 'connectors':
      return <ConnectorsProperties nodeId={nodeId} data={data} />;
    case 'storage':
      return <StorageProperties nodeId={nodeId} data={data} />;
    case 'vectorDatabase':
      return <VectorDatabaseProperties nodeId={nodeId} data={data} />;
  }
}

export default function PropertiesPanel() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const nodes = useGraphStore((s) => s.nodes);
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode);
  const removeNode = useGraphStore((s) => s.removeNode);

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const color = NODE_COLORS[node.data.type];
  const label = NODE_LABELS[node.data.type];

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-slate-800 bg-slate-925">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <h2 className="text-xs font-bold text-slate-200">{label} Properties</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              removeNode(node.id);
              setSelectedNode(null);
            }}
            className="rounded p-1 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
            title="Delete node"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => setSelectedNode(null)}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-700 hover:text-slate-300"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto p-4">
        <PropertyEditorForType nodeId={node.id} data={node.data} />
      </div>
    </aside>
  );
}
