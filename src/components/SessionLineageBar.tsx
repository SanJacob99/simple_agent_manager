import { ChevronRight } from 'lucide-react';
import type { SessionLineage } from '../../shared/storage-types';

interface Props {
  lineage: SessionLineage;
  onNavigate: (sessionKey: string) => void;
}

export default function SessionLineageBar({ lineage, onNavigate }: Props) {
  if (lineage.ancestors.length === 0) return null;

  return (
    <div className="flex items-center gap-1 border-b border-slate-800 bg-slate-900/80 px-3 py-1.5 text-[10px] text-slate-400">
      {[...lineage.ancestors].reverse().map((ancestor) => (
        <span key={ancestor.sessionId} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onNavigate(ancestor.sessionKey)}
            className="rounded px-1 py-0.5 hover:bg-slate-800 hover:text-slate-300"
          >
            {new Date(ancestor.createdAt).toLocaleDateString()}
          </button>
          <ChevronRight size={10} className="text-slate-600" />
        </span>
      ))}
      <span className="font-medium text-slate-300">
        Current ({new Date(lineage.current.createdAt).toLocaleDateString()})
      </span>
    </div>
  );
}
