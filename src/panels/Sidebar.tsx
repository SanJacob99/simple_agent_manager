import {
  Bot,
  BrainCircuit,
  Wrench,
  Sparkles,
  BookOpen,
  MessageSquare,
  Plug,
  Database,
  Container,
  Download,
  Upload,
  FileJson,
} from 'lucide-react';
import type { NodeType } from '../types/nodes';
import { NODE_COLORS, NODE_LABELS } from '../utils/theme';
import type { DragEvent, ReactNode } from 'react';
import { useGraphStore } from '../store/graph-store';
import {
  exportGraph,
  importGraph,
  downloadJson,
  uploadJson,
} from '../utils/export-import';
import testFixture from '../fixtures/test-graph.json';
import {
  SETTINGS_SECTIONS,
  type AppView,
  type SettingsSectionId,
} from '../settings/types';

interface PaletteItem {
  type: NodeType;
  icon: ReactNode;
}

const CORE_ITEMS: PaletteItem[] = [{ type: 'agent', icon: <Bot size={16} /> }];

const PERIPHERAL_ITEMS: PaletteItem[] = [
  { type: 'memory', icon: <BrainCircuit size={16} /> },
  { type: 'tools', icon: <Wrench size={16} /> },
  { type: 'skills', icon: <Sparkles size={16} /> },
  { type: 'contextEngine', icon: <BookOpen size={16} /> },
  { type: 'agentComm', icon: <MessageSquare size={16} /> },
  { type: 'connectors', icon: <Plug size={16} /> },
  { type: 'database', icon: <Database size={16} /> },
  { type: 'vectorDatabase', icon: <Container size={16} /> },
];

function DraggableItem({ item }: { item: PaletteItem }) {
  const color = NODE_COLORS[item.type];
  const label = NODE_LABELS[item.type];

  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData('application/reactflow', item.type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex cursor-grab items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2.5 transition-colors hover:border-slate-600 hover:bg-slate-800 active:cursor-grabbing"
    >
      <span style={{ color }}>{item.icon}</span>
      <span className="text-xs font-medium text-slate-300">{label}</span>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400 transition hover:border-slate-600 hover:bg-slate-800 hover:text-slate-200"
    >
      {icon}
      {label}
    </button>
  );
}

interface SidebarProps {
  appView: AppView;
  activeSettingsSection: SettingsSectionId;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
}

export default function Sidebar({
  appView,
  activeSettingsSection,
  onSettingsSectionChange,
}: SidebarProps) {
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const loadGraph = useGraphStore((s) => s.loadGraph);

  const handleExport = () => {
    const bundle = exportGraph(nodes, edges);
    downloadJson(bundle, `agent-graph-${Date.now()}.json`);
  };

  const handleImport = async () => {
    try {
      const data = await uploadJson();
      const result = importGraph(data);
      if (result) {
        loadGraph(result.nodes, result.edges);
      } else {
        alert('Invalid graph file format.');
      }
    } catch {
      // User cancelled or invalid file
    }
  };

  const handleLoadFixture = () => {
    const result = importGraph(testFixture);
    if (result) {
      loadGraph(result.nodes, result.edges);
    }
  };

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-925">
      {/* Header */}
      <div className="border-b border-slate-800 px-4 py-3">
        <h1 className="text-sm font-bold text-slate-100">Agent Manager</h1>
        <p className="mt-0.5 text-[10px] text-slate-500">
          {appView === 'canvas'
            ? 'Drag nodes onto the canvas'
            : 'App-level settings'}
        </p>
      </div>

      {appView === 'canvas' ? (
        /* Node Palette */
        <div className="flex-1 overflow-y-auto p-3">
          {/* Core */}
          <div className="mb-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Core
            </h2>
            <div className="space-y-1.5">
              {CORE_ITEMS.map((item) => (
                <DraggableItem key={item.type} item={item} />
              ))}
            </div>
          </div>

          {/* Peripherals */}
          <div className="mb-4">
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Peripherals
            </h2>
            <div className="space-y-1.5">
              {PERIPHERAL_ITEMS.map((item) => (
                <DraggableItem key={item.type} item={item} />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div>
            <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Actions
            </h2>
            <div className="space-y-1.5">
              <ActionButton
                icon={<Download size={14} />}
                label="Export Graph"
                onClick={handleExport}
              />
              <ActionButton
                icon={<Upload size={14} />}
                label="Import Graph"
                onClick={handleImport}
              />
              <ActionButton
                icon={<FileJson size={14} />}
                label="Load Test Fixture"
                onClick={handleLoadFixture}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-3">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Sections
          </h2>
          <div className="space-y-1.5">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                onClick={() => onSettingsSectionChange(section.id)}
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${
                  activeSettingsSection === section.id
                    ? 'border-blue-500/60 bg-blue-500/10 text-blue-200'
                    : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                }`}
              >
                <div className="font-medium">{section.label}</div>
                <div className="mt-0.5 text-[10px] text-slate-500">
                  {section.description}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
