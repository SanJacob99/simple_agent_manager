import {
  MessageSquare,
  BrainCircuit,
  PocketKnife,
  GraduationCap,
  ScrollText,
  Radio,
  Cable,
  HardDrive,
  Blocks,
  Cloud,
  Search,
} from 'lucide-react';
import type { NodeType } from '../types/nodes';
import { NODE_COLORS, NODE_LABELS } from '../utils/theme';
import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import {
  SETTINGS_SECTIONS,
  type AppView,
  type SettingsSectionId,
} from '../settings/types';

interface PaletteItem {
  type: NodeType;
  icon: ReactNode;
}

const CORE_ITEMS: PaletteItem[] = [
  { type: 'agent', icon: <MessageSquare size={18} /> },
];

const PERIPHERAL_ITEMS: PaletteItem[] = [
  { type: 'memory', icon: <BrainCircuit size={18} /> },
  { type: 'tools', icon: <PocketKnife size={18} /> },
  { type: 'skills', icon: <GraduationCap size={18} /> },
  { type: 'contextEngine', icon: <ScrollText size={18} /> },
  { type: 'agentComm', icon: <Radio size={18} /> },
  { type: 'connectors', icon: <Cable size={18} /> },
  { type: 'storage', icon: <HardDrive size={18} /> },
  { type: 'vectorDatabase', icon: <Blocks size={18} /> },
  { type: 'provider' as NodeType, icon: <Cloud size={18} /> },
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
      className="group flex cursor-grab items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-slate-800/60 active:cursor-grabbing"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
          color,
        }}
      >
        {item.icon}
      </span>
      <span className="text-sm font-medium text-slate-300 group-hover:text-slate-100">
        {label}
      </span>
    </div>
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
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();

  const filteredCore = useMemo(
    () =>
      normalizedQuery
        ? CORE_ITEMS.filter((item) =>
            NODE_LABELS[item.type].toLowerCase().includes(normalizedQuery),
          )
        : CORE_ITEMS,
    [normalizedQuery],
  );

  const filteredPeripherals = useMemo(
    () =>
      normalizedQuery
        ? PERIPHERAL_ITEMS.filter((item) =>
            NODE_LABELS[item.type].toLowerCase().includes(normalizedQuery),
          )
        : PERIPHERAL_ITEMS,
    [normalizedQuery],
  );

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-canvas-bg">
      {/* Header */}
      <div className="px-4 pb-3 pt-4">
        <h1 className="text-sm font-bold text-slate-100">Agent Manager</h1>
      </div>

      {appView === 'canvas' ? (
        <>
          {/* Search */}
          <div className="px-3 pb-3">
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search components…"
                className="w-full rounded-md border border-slate-800 bg-slate-900/60 py-1.5 pl-7 pr-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-slate-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Node Palette */}
          <div className="flex-1 overflow-y-auto px-2 pb-3">
            {filteredCore.length > 0 && (
              <div className="mb-4">
                <h2 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Core
                </h2>
                <div className="space-y-1">
                  {filteredCore.map((item) => (
                    <DraggableItem key={item.type} item={item} />
                  ))}
                </div>
              </div>
            )}

            {filteredPeripherals.length > 0 && (
              <div className="mb-4">
                <h2 className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Peripherals
                </h2>
                <div className="space-y-1">
                  {filteredPeripherals.map((item) => (
                    <DraggableItem key={item.type} item={item} />
                  ))}
                </div>
              </div>
            )}

            {filteredCore.length === 0 && filteredPeripherals.length === 0 && (
              <p className="px-2 py-6 text-center text-[11px] text-slate-500">
                No components match “{query}”.
              </p>
            )}
          </div>
        </>
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
                className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition ${activeSettingsSection === section.id
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
