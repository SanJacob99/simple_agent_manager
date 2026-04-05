import { AlertTriangle, Bot, Database, Trash2, X } from 'lucide-react';
import { useGraphStore } from '../store/graph-store';

export default function AgentDeleteDialog() {
  const pendingDeleteAgent = useGraphStore((s) => s.pendingDeleteAgent);
  const cancelDeleteAgent = useGraphStore((s) => s.cancelDeleteAgent);
  const confirmDeleteAgent = useGraphStore((s) => s.confirmDeleteAgent);

  if (!pendingDeleteAgent) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[420px] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 rounded-t-xl border-b border-slate-800 bg-slate-800/50 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10">
            <AlertTriangle size={18} className="text-red-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">Delete Agent</h2>
            <p className="text-[10px] text-slate-500">
              Removing "{pendingDeleteAgent.agentName}" from the canvas
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-300">
            You are about to remove <strong>{pendingDeleteAgent.agentName}</strong>.
            Do you also want to permanently delete all of this agent's chat history and storage data?
          </p>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => confirmDeleteAgent(true)}
              className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-left transition hover:bg-red-500/20"
            >
              <div className="rounded-md bg-red-500/20 p-2">
                <Trash2 size={16} className="text-red-400" />
              </div>
              <div>
                <div className="text-xs font-semibold text-red-300">Yes, delete agent and data</div>
                <div className="text-[10px] text-red-400/80">Removes agent from canvas and permanently deletes all sessions.</div>
              </div>
            </button>

            <button
              onClick={() => confirmDeleteAgent(false)}
              className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-800/50 px-4 py-3 text-left transition hover:bg-slate-800"
            >
              <div className="rounded-md bg-slate-700 p-2">
                <Database size={16} className="text-slate-400" />
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-200">No, keep data</div>
                <div className="text-[10px] text-slate-400">Removes agent from canvas, but preserves its storage data.</div>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-800 px-5 py-3">
          <button
            onClick={cancelDeleteAgent}
            className="rounded-lg px-4 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
