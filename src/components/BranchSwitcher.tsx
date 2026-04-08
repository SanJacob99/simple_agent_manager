import type { BranchInfo } from '../../shared/storage-types';

interface Props {
  branches: BranchInfo[];
  activeBranchId?: string;
  onSelect: (branchId: string) => void;
  onClose: () => void;
}

export default function BranchSwitcher({ branches, activeBranchId, onSelect, onClose }: Props) {
  return (
    <div className="absolute z-50 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold text-slate-300">Branches</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Close
        </button>
      </div>
      <div className="max-h-60 overflow-y-auto p-1">
        {branches.map((branch) => (
          <button
            key={branch.branchId}
            type="button"
            onClick={() => onSelect(branch.branchId)}
            className={`w-full rounded-md px-3 py-2 text-left transition ${
              branch.branchId === activeBranchId
                ? 'bg-slate-800 text-slate-200'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-300'
            }`}
          >
            <div className="text-xs font-medium">{branch.label}</div>
            <div className="mt-0.5 truncate text-[10px] text-slate-500">
              {branch.preview || 'No preview'}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-600">
              <span>{branch.entryCount} messages</span>
              <span>{new Date(branch.timestamp).toLocaleString()}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
