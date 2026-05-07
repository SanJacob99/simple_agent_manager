import {
  BrainCircuit,
  PocketKnife,
  GraduationCap,
  ScrollText,
  Radio,
  Cable,
  HardDrive,
  Blocks,
  Cloud,
  Plug,
  Bot,
} from 'lucide-react';
import type { NodeType } from '../types/nodes';
import { NODE_COLORS, NODE_LABELS, NODE_PASTEL } from '../utils/theme';
import { useRef, type DragEvent, type ReactNode } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useUILayoutStore } from '../store/ui-layout-store';
import {
  CHAT_PANEL_CLOSED_WIDTH,
  CHAT_PANEL_OPEN_WIDTH,
} from '../chat/SAMAgent';
import {
  HEX_HEIGHT,
  HEX_WIDTH,
  roundedHexPathPointyTop,
  HEX_SIDE,
  HEX_CORNER_RADIUS,
} from '../nodes/HexNode';

const HEX_PREVIEW_PATH = roundedHexPathPointyTop(
  HEX_WIDTH / 2,
  HEX_HEIGHT / 2,
  HEX_SIDE,
  HEX_CORNER_RADIUS,
);
import {
  SETTINGS_SECTIONS,
  type AppView,
  type SettingsSectionId,
} from '../settings/types';
import TemplatesPanel from './TemplatesPanel';

interface PaletteItem {
  type: NodeType;
  icon: ReactNode;
}

const ICON_SIZE = 26;
const ICON_STROKE = 2.2;

const CORE_ITEMS: PaletteItem[] = [
  {
    type: 'agent',
    icon: <img src="/svg/favicon.svg" alt="" width={ICON_SIZE} height={ICON_SIZE} />,
  },
];

const PERIPHERAL_ITEMS: PaletteItem[] = [
  { type: 'memory', icon: <BrainCircuit size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'tools', icon: <PocketKnife size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'skills', icon: <GraduationCap size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'contextEngine', icon: <ScrollText size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'agentComm', icon: <Radio size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'connectors', icon: <Cable size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'storage', icon: <HardDrive size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'vectorDatabase', icon: <Blocks size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'mcp', icon: <Plug size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'provider' as NodeType, icon: <Cloud size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
  { type: 'subAgent', icon: <Bot size={ICON_SIZE} strokeWidth={ICON_STROKE} /> },
];

const TILE_SHADOW =
  '0 4px 10px -4px rgba(120,90,60,0.18), 0 1px 2px rgba(120,90,60,0.06), inset 0 0 0 1px rgba(255,255,255,0.6)';

function DraggableItem({ item }: { item: PaletteItem }) {
  const color = NODE_COLORS[item.type];
  const pastel = NODE_PASTEL[item.type];
  const label = NODE_LABELS[item.type];
  const previewRef = useRef<HTMLDivElement | null>(null);
  const { getViewport } = useReactFlow();

  const onDragStart = (event: DragEvent) => {
    event.dataTransfer.setData('application/reactflow', item.type);
    event.dataTransfer.effectAllowed = 'move';

    const preview = previewRef.current;
    if (preview) {
      const zoom = getViewport().zoom;
      const w = HEX_WIDTH * zoom;
      const h = HEX_HEIGHT * zoom;
      preview.style.width = `${w}px`;
      preview.style.height = `${h}px`;
      event.dataTransfer.setDragImage(preview, w / 2, h / 2);
    }
  };

  return (
    <>
      <div
        draggable
        onDragStart={onDragStart}
        className="group/item flex cursor-grab items-center gap-3 active:cursor-grabbing"
      >
        <span
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] transition-transform duration-200 ease-out group-hover/item:scale-[1.04]"
          style={{
            backgroundColor: pastel.bg,
            color: pastel.fg,
            boxShadow: TILE_SHADOW,
          }}
        >
          {item.icon}
        </span>
        <span className="whitespace-nowrap text-sm font-medium text-stone-700 opacity-0 transition-opacity duration-200 ease-out group-hover/item:text-stone-900 group-hover:opacity-100">
          {label}
        </span>
      </div>
      {/* Hidden hex preview used as the HTML5 drag image */}
      <div
        ref={previewRef}
        aria-hidden
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          width: HEX_WIDTH,
          height: HEX_HEIGHT,
          pointerEvents: 'none',
          filter: 'drop-shadow(0 4px 10px var(--c-node-shadow))',
        }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${HEX_WIDTH} ${HEX_HEIGHT}`}
          style={{ display: 'block' }}
        >
          <path d={HEX_PREVIEW_PATH} fill="var(--c-slate-900)" />
          <rect
            x={0}
            y={0}
            width={HEX_WIDTH * 0.1}
            height={HEX_HEIGHT}
            fill={color}
            clipPath={`path('${HEX_PREVIEW_PATH}')`}
          />
          <path
            d={HEX_PREVIEW_PATH}
            fill="none"
            stroke="var(--c-node-border-default)"
            strokeWidth={4}
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </>
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
  const chatPanelOpen = useUILayoutStore((s) => s.chatPanelOpen);
  const chatPanelWidth = chatPanelOpen
    ? CHAT_PANEL_OPEN_WIDTH
    : CHAT_PANEL_CLOSED_WIDTH;
  // Chat panel sits at left-3 (12px). Add panel width + 12px gap.
  const sidebarLeft = 12 + chatPanelWidth + 12;

  return (
    <div className="relative w-0 shrink-0">
      <aside
        className="group absolute top-1/2 z-30 flex max-h-[calc(100vh-24px)] w-[84px] -translate-y-1/2 flex-col overflow-hidden rounded-[44px] bg-[#FFFDF8] transition-[left,width] duration-200 ease-out hover:w-64"
        style={{
          left: sidebarLeft,
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.9), 0 12px 28px -12px rgba(140,110,80,0.18), 0 2px 6px -2px rgba(140,110,80,0.08)',
        }}
      >
        <div className="flex h-full w-64 flex-col">
          {appView === 'canvas' ? (
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <div className="px-[14px] pb-3 pt-3">
                <div className="mb-2.5 space-y-2.5">
                  {CORE_ITEMS.map((item) => (
                    <DraggableItem key={item.type} item={item} />
                  ))}
                </div>

                <div className="space-y-2.5">
                  {PERIPHERAL_ITEMS.map((item) => (
                    <DraggableItem key={item.type} item={item} />
                  ))}
                </div>
              </div>

              {/* Templates only render their richer UI in the expanded
                  state (sidebar grows from 84px to 256px on hover). When
                  collapsed, the borderline still hints that there's more. */}
              <div className="pointer-events-none opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
                <TemplatesPanel />
              </div>
            </div>
          ) : (
            <div className="pointer-events-none flex-1 overflow-y-auto p-4 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
              <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
                Sections
              </h2>
              <div className="space-y-1.5">
                {SETTINGS_SECTIONS.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => onSettingsSectionChange(section.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-xs transition ${activeSettingsSection === section.id
                      ? 'border-blue-400/60 bg-blue-100 text-blue-800'
                      : 'border-stone-300 bg-white/60 text-stone-700 hover:border-stone-400 hover:bg-white'
                      }`}
                  >
                    <div className="font-medium">{section.label}</div>
                    <div className="mt-0.5 text-[10px] text-stone-500">
                      {section.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
