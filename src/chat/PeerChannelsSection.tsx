import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, Radio } from 'lucide-react';
import { useSessionStore, type PeerChannelSummary } from '../store/session-store';

interface PeerChannelsSectionProps {
  agentId: string;
  /** Only render if the agent has declared direct-protocol comm edges. */
  hasPeers: boolean;
}

function formatRelativeTime(iso: string): string {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

interface TranscriptModalProps {
  channelKey: string;
  peerAgentName: string;
  agentId: string;
  onClose: () => void;
}

function TranscriptModal({ channelKey, peerAgentName, agentId, onClose }: TranscriptModalProps) {
  const [events, setEvents] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchTranscript = useSessionStore((s) => s.fetchPeerChannelTranscript);

  // Fetch on mount
  useEffect(() => {
    fetchTranscript(agentId, channelKey, 100)
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch(() => {
        setEvents([]);
        setLoading(false);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, channelKey]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <span className="text-xs font-semibold text-slate-200">
            Channel transcript — {peerAgentName}
          </span>
          <button
            onClick={onClose}
            className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-300 text-xs"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <p className="text-[11px] text-slate-500 italic">Loading…</p>
          )}
          {!loading && events && events.length === 0 && (
            <p className="text-[11px] text-slate-500 italic">No events yet.</p>
          )}
          {!loading && events && events.length > 0 && (
            <pre className="whitespace-pre-wrap break-all text-[10px] leading-relaxed text-slate-300">
              {JSON.stringify(events, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PeerChannelsSection({ agentId, hasPeers }: PeerChannelsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [channels, setChannels] = useState<PeerChannelSummary[] | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [viewingTranscript, setViewingTranscript] = useState<PeerChannelSummary | null>(null);
  const listPeerChannels = useSessionStore((s) => s.listPeerChannels);

  const handleExpand = useCallback(async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && channels === null) {
      setLoadingChannels(true);
      try {
        const data = await listPeerChannels(agentId);
        setChannels(data);
      } catch {
        setChannels([]);
      } finally {
        setLoadingChannels(false);
      }
    }
  }, [expanded, channels, agentId, listPeerChannels]);

  if (!hasPeers) return null;

  return (
    <>
      <div className="border-t border-slate-800/50 px-4 py-1.5">
        <button
          onClick={handleExpand}
          className="flex w-full items-center gap-1.5 text-left"
        >
          {expanded
            ? <ChevronDown size={10} className="text-slate-500 flex-shrink-0" />
            : <ChevronRight size={10} className="text-slate-500 flex-shrink-0" />}
          <Radio size={10} className="text-slate-500 flex-shrink-0" />
          <span className="text-[9px] uppercase tracking-wider text-slate-600 font-semibold">
            Peer channels
          </span>
        </button>

        {expanded && (
          <div className="mt-1.5 space-y-1">
            {loadingChannels && (
              <p className="text-[10px] text-slate-600 italic px-1">Loading…</p>
            )}
            {!loadingChannels && channels && channels.length === 0 && (
              <p className="text-[10px] text-slate-600 italic px-1">No active channels yet.</p>
            )}
            {!loadingChannels && channels && channels.map((ch) => (
              <button
                key={ch.channelKey}
                onClick={() => setViewingTranscript(ch)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-slate-800/60"
              >
                <span className="flex-1 truncate text-[10px] text-slate-300">
                  {ch.peerAgentName || ch.peerAgentId}
                </span>
                <span className="text-[9px] text-slate-500">
                  {ch.turns} turn{ch.turns !== 1 ? 's' : ''}
                </span>
                {ch.sealed && (
                  <span className="rounded bg-amber-500/20 px-1 py-0.5 text-[8px] font-medium text-amber-400">
                    sealed
                  </span>
                )}
                {ch.lastActivityAt && (
                  <span className="text-[9px] text-slate-600">
                    {formatRelativeTime(ch.lastActivityAt)}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {viewingTranscript && (
        <TranscriptModal
          channelKey={viewingTranscript.channelKey}
          peerAgentName={viewingTranscript.peerAgentName || viewingTranscript.peerAgentId}
          agentId={agentId}
          onClose={() => setViewingTranscript(null)}
        />
      )}
    </>
  );
}
