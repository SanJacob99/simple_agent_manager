import { useEffect, useState } from 'react';
import { HelpCircle, CheckCircle2, XCircle } from 'lucide-react';
import type { PendingHitlInfo } from './useChatStream';

interface HitlBannerProps {
  pending: PendingHitlInfo;
  onConfirmAnswer: (answer: 'yes' | 'no') => void;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0s';
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

/**
 * Sticky prompt banner shown above the chat input when the agent is waiting
 * on a human response. For kind='confirm' the Yes/No buttons are the fast
 * path; the text input below the banner is also wired to the HITL responder
 * (in ChatDrawer), so "yes"/"no" typed manually works too.
 */
export default function HitlBanner({ pending, onConfirmAnswer }: HitlBannerProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const elapsed = now - pending.createdAt;
  const remaining = Math.max(0, pending.timeoutMs - elapsed);

  return (
    <div className="border-t border-amber-500/30 bg-amber-500/5 px-4 py-2.5 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <HelpCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-amber-400/80 font-semibold">
            Agent is asking
          </p>
          <p className="text-xs text-slate-100 leading-snug mt-0.5">
            {pending.question}
          </p>
        </div>
        <span className="text-[9px] tabular-nums text-slate-500 font-mono mt-0.5 flex-shrink-0">
          {formatRemaining(remaining)}
        </span>
      </div>

      {pending.kind === 'confirm' ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onConfirmAnswer('yes')}
            className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs text-emerald-300 transition hover:bg-emerald-500/20 hover:border-emerald-400/50"
          >
            <CheckCircle2 size={12} />
            Yes
          </button>
          <button
            type="button"
            onClick={() => onConfirmAnswer('no')}
            className="flex items-center gap-1.5 rounded-md bg-slate-700/50 border border-slate-600/50 px-3 py-1 text-xs text-slate-300 transition hover:bg-slate-700 hover:border-slate-500"
          >
            <XCircle size={12} />
            No
          </button>
          <span className="text-[9px] text-slate-600">
            or type "yes" / "no" below
          </span>
        </div>
      ) : (
        <p className="text-[10px] text-slate-500 pl-6">
          Type your answer below and send.
        </p>
      )}
    </div>
  );
}
