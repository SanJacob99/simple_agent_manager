import { GitBranch } from 'lucide-react';

interface Props {
  branchCount: number;
  onClick: () => void;
}

export default function BranchIndicator({ branchCount, onClick }: Props) {
  if (branchCount <= 1) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="my-1 flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-slate-300"
    >
      <GitBranch size={12} />
      <span>{branchCount} branches</span>
    </button>
  );
}
