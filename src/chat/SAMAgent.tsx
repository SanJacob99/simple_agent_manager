import { useEffect, useState } from 'react';
import { Send, Trash2, Settings } from 'lucide-react';
import { useUILayoutStore } from '../store/ui-layout-store';
import { useSamAgentStore } from '../store/sam-agent-store';
import { useSettingsStore } from '../settings/settings-store';
import { useGraphStore } from '../store/graph-store';
import { agentClient } from '../client';
import { samAgentClient } from '../client/sam-agent-client';
import { SamAgentMessages } from './sam-agent-messages';
import type { SettingsSectionId } from '../settings/types';

const ISLAND_SHADOW =
  'inset 0 1px 0 rgba(255,255,255,0.9), 0 12px 28px -12px rgba(140,110,80,0.18), 0 2px 6px -2px rgba(140,110,80,0.08)';

export const CHAT_PANEL_OPEN_WIDTH = 360;
export const CHAT_PANEL_CLOSED_WIDTH = 56;

interface SAMAgentProps {
  onOpenSettings: (section: SettingsSectionId) => void;
}

export default function SAMAgent({ onOpenSettings }: SAMAgentProps) {
  const open = useUILayoutStore((s) => s.chatPanelOpen);
  const toggle = useUILayoutStore((s) => s.toggleChatPanel);

  const messages = useSamAgentStore((s) => s.messages);
  const streaming = useSamAgentStore((s) => s.streaming);
  const hitlPending = useSamAgentStore((s) => s.hitlPending);
  const transcriptLoaded = useSamAgentStore((s) => s.transcriptLoaded);
  const handleEvent = useSamAgentStore((s) => s.handleEvent);
  const loadTranscript = useSamAgentStore((s) => s.loadTranscript);
  const appendUserMessage = useSamAgentStore((s) => s.appendUserMessage);
  const clearLocal = useSamAgentStore((s) => s.clearLocal);

  const samAgentDefaults = useSettingsStore((s) => s.samAgentDefaults);
  const apiKeys = useSettingsStore((s) => s.apiKeys);

  const buildGraphSnapshot = useGraphStore((s) => s.buildGraphSnapshot);

  const modelSelection = samAgentDefaults?.modelSelection ?? null;
  const thinkingLevel = samAgentDefaults?.thinkingLevel ?? 'high';

  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!open) return;
    // Subscribe to raw WebSocket events to handle both transcript and agent event envelopes
    const offEvent = agentClient.onEvent((serverEvent) => {
      if (serverEvent.type === 'samAgent:transcript') {
        loadTranscript(serverEvent.messages);
      } else if (serverEvent.type === 'samAgent:event') {
        handleEvent(serverEvent.event);
      }
    });
    // Issue start() now if already connected, and on every (re)connect so we
    // survive hard-reload boot races where WS wasn't open when the panel mounted.
    if (agentClient.status === 'connected' && !transcriptLoaded) {
      samAgentClient.start();
    }
    const offStatus = agentClient.onStatusChange((status) => {
      if (status === 'connected' && !useSamAgentStore.getState().transcriptLoaded) {
        samAgentClient.start();
      }
    });
    return () => {
      offEvent();
      offStatus();
    };
  }, [open, transcriptLoaded, loadTranscript, handleEvent]);

  // apiKeys are keyed by pluginId (consistent with ModelCatalogSection pattern)
  const apiKeyForProvider = modelSelection
    ? (apiKeys[modelSelection.provider.pluginId] ?? apiKeys[modelSelection.provider.envVar] ?? '')
    : '';
  const hasProvider = !!modelSelection && !!apiKeyForProvider;
  const isStreaming = streaming !== null;

  const handleSend = () => {
    if (!hasProvider || !modelSelection || draft.trim().length === 0) return;
    if (hitlPending) {
      samAgentClient.hitlRespond(
        hitlPending.toolCallId,
        hitlPending.kind === 'confirm'
          ? { kind: 'confirm', answer: draft.trim().toLowerCase().startsWith('y') ? 'yes' : 'no' }
          : { kind: 'text', answer: draft.trim() },
      );
      setDraft('');
      return;
    }
    appendUserMessage(draft.trim());
    samAgentClient.prompt(draft.trim(), buildGraphSnapshot(), {
      ...modelSelection,
      thinkingLevel,
    });
    setDraft('');
  };

  const handleClear = () => {
    samAgentClient.clear();
    clearLocal();
  };

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
          <header className="flex items-center justify-between gap-2 px-6 pt-5">
            <h2 className="shrink-0 text-sm font-semibold text-stone-700">SAMAgent</h2>
            <div className="flex min-w-0 items-center gap-1">
              <button
                onClick={() => onOpenSettings('sam-agent')}
                title={modelSelection
                  ? `${modelSelection.provider.pluginId} / ${modelSelection.modelId} · thinking ${thinkingLevel} — click to configure`
                  : 'Configure SAMAgent'}
                className="flex min-w-0 max-w-[160px] items-center gap-1 truncate rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-[11px] text-stone-600 transition hover:bg-stone-100"
              >
                <Settings size={11} className="shrink-0 text-stone-400" />
                <span className="truncate">
                  {modelSelection
                    ? `${modelSelection.modelId} · ${thinkingLevel}`
                    : 'Configure'}
                </span>
              </button>
              <button
                onClick={handleClear}
                title="Clear conversation"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-700"
              >
                <Trash2 size={14} />
              </button>
              <button
                onClick={toggle}
                title="Collapse SAMAgent"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-700"
              >
                <img src="/svg/power.svg" alt="" width={18} height={18} />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {!hasProvider ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-xs text-stone-400">SAMAgent needs a model and an API key.</p>
                <button
                  onClick={() => onOpenSettings('sam-agent')}
                  className="rounded-md bg-stone-800 px-3 py-1.5 text-xs text-white transition hover:bg-stone-700"
                >
                  Configure SAMAgent
                </button>
              </div>
            ) : (
              <SamAgentMessages messages={messages} streaming={streaming} />
            )}
          </div>

          <div className="px-4 pb-5">
            {hitlPending && (
              <div className="mb-2 rounded-md bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
                {hitlPending.kind === 'confirm' ? 'Confirm: ' : 'SAMAgent asks: '}{hitlPending.question}
              </div>
            )}
            <div
              className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-white/80 px-3 py-2"
              style={{ boxShadow: '0 1px 2px rgba(120,90,60,0.06)' }}
            >
              <input
                type="text"
                disabled={!hasProvider || isStreaming}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                placeholder={hasProvider ? (isStreaming ? 'SAMAgent is responding…' : hitlPending ? 'Type your answer…' : 'Ask SAMAgent…') : 'Configure provider in Settings'}
                className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={handleSend}
                disabled={!hasProvider || isStreaming || draft.trim().length === 0}
                title="Send"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-800 text-white transition hover:bg-stone-700 disabled:opacity-40"
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
