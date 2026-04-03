import { useState, useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, Bot, Check } from 'lucide-react';
import { useGraphStore } from '../store/graph-store';

interface AgentNameDialogProps {
  nodeId: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export default function AgentNameDialog({
  nodeId,
  onConfirm,
  onCancel,
}: AgentNameDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nodes = useGraphStore((s) => s.nodes);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validate = useCallback(
    (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return 'Agent name is required.';
      if (trimmed.length < 2)
        return 'Name must be at least 2 characters.';
      if (trimmed.length > 40) return 'Name must be 40 characters or fewer.';
      if (/[:\/\\]/.test(trimmed))
        return 'Name cannot contain : / or \\ characters.';

      // Check uniqueness
      const taken = nodes.some(
        (n) =>
          n.id !== nodeId &&
          n.data.type === 'agent' &&
          (n.data as { name?: string }).name?.toLowerCase() ===
            trimmed.toLowerCase(),
      );
      if (taken) return `An agent named "${trimmed}" already exists.`;

      return null;
    },
    [nodes, nodeId],
  );

  const handleSubmit = () => {
    const err = validate(name);
    if (err) {
      setError(err);
      return;
    }
    onConfirm(name.trim());
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[380px] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 rounded-t-xl border-b border-slate-800 bg-slate-800/50 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
            <Bot size={18} className="text-blue-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">Name Your Agent</h2>
            <p className="text-[10px] text-slate-500">
              This name is permanent and identifies your agent's sessions.
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Agent Name
            </label>
            <input
              ref={inputRef}
              className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 transition ${
                error
                  ? 'border-red-500/60 bg-red-500/5 focus:border-red-500 focus:ring-red-500/30'
                  : 'border-slate-700 bg-slate-800 focus:border-blue-500 focus:ring-blue-500/30'
              }`}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(validate(e.target.value));
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="e.g. codebot, researcher, translator"
              autoFocus
            />
            {error && (
              <p className="mt-1 text-[10px] text-red-400">{error}</p>
            )}
          </div>

          {/* Warning */}
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
            <AlertTriangle
              size={14}
              className="mt-0.5 flex-shrink-0 text-amber-400"
            />
            <p className="text-[10px] leading-relaxed text-amber-300/80">
              Choose carefully — the agent name <strong>cannot be changed</strong>{' '}
              later. It is used to identify conversation sessions and must be
              unique across all agents.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            Cancel & Remove
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check size={12} />
            Confirm Name
          </button>
        </div>
      </div>
    </div>
  );
}
