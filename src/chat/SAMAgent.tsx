import { Send } from 'lucide-react';
import { useUILayoutStore } from '../store/ui-layout-store';

const ISLAND_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.9), 0 12px 28px -12px rgba(140,110,80,0.18), 0 2px 6px -2px rgba(140,110,80,0.08)';

export const CHAT_PANEL_OPEN_WIDTH = 360;
export const CHAT_PANEL_CLOSED_WIDTH = 56;

export default function SAMAgent() {
  const open = useUILayoutStore((s) => s.chatPanelOpen);
  const toggle = useUILayoutStore((s) => s.toggleChatPanel);

  return (
    <aside
      className="absolute bottom-3 left-3 top-3 z-30 flex flex-col overflow-hidden rounded-[44px] bg-[#FFFDF8] transition-[width] duration-200 ease-out"
      style={{
        width: open ? CHAT_PANEL_OPEN_WIDTH : CHAT_PANEL_CLOSED_WIDTH,
        boxShadow: ISLAND_SHADOW,
      }}
    >
      {open ? (
        <div className="flex h-full w-full flex-col">
          <header className="flex items-center justify-between px-6 pt-5">
            <h2 className="text-sm font-semibold text-stone-700">SAMAgent</h2>
            <button
              onClick={toggle}
              title="Collapse SAMAgent"
              className="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-700"
            >
              <img src="/svg/power.svg" alt="" width={18} height={18} />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="text-xs text-stone-400">
                No conversation yet.
              </p>
              <p className="mt-1 text-[11px] text-stone-400">
                Start chatting to see messages here.
              </p>
            </div>
          </div>

          <div className="px-4 pb-5">
            <div
              className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-white/80 px-3 py-2"
              style={{ boxShadow: '0 1px 2px rgba(120,90,60,0.06)' }}
            >
              <input
                type="text"
                placeholder="Type a message…"
                className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none"
              />
              <button
                title="Send"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-800 text-white transition hover:bg-stone-700"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={toggle}
          title="Open SAMAgent"
          className="flex h-full w-full items-center justify-center text-stone-500 transition hover:text-stone-700"
        >
          <img src="/svg/power.svg" alt="" width={22} height={22} />
        </button>
      )}
    </aside>
  );
}
