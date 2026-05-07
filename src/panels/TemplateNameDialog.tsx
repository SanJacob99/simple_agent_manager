import { useState, useCallback, useEffect, useRef } from 'react';
import { AlertTriangle, Layers, Check } from 'lucide-react';
import { useTemplateStore } from '../store/template-store';

interface TemplateNameDialogProps {
  initialName?: string;
  onConfirm: (name: string, description: string) => void;
  onCancel: () => void;
}

export default function TemplateNameDialog({
  initialName = '',
  onConfirm,
  onCancel,
}: TemplateNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNameTaken = useTemplateStore((s) => s.isNameTaken);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const validate = useCallback(
    (value: string): string | null => {
      const trimmed = value.trim();
      if (!trimmed) return 'Template name is required.';
      if (trimmed.length > 60) return 'Name must be 60 characters or fewer.';
      if (isNameTaken(trimmed))
        return `A template named "${trimmed}" already exists.`;
      return null;
    },
    [isNameTaken],
  );

  const handleSubmit = () => {
    const err = validate(name);
    if (err) {
      setError(err);
      return;
    }
    onConfirm(name.trim(), description.trim());
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[420px] rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-3 rounded-t-xl border-b border-slate-800 bg-slate-800/50 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
            <Layers size={18} className="text-violet-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100">
              Save Selection as Template
            </h2>
            <p className="text-[10px] text-slate-500">
              Reuse this group of nodes when building future agents.
            </p>
          </div>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Template Name
            </label>
            <input
              ref={inputRef}
              className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-200 placeholder-slate-500 transition focus:outline-none focus:ring-1 ${
                error
                  ? 'border-red-500/60 bg-red-500/5 focus:border-red-500 focus:ring-red-500/30'
                  : 'border-slate-700 bg-slate-800 focus:border-violet-500 focus:ring-violet-500/30'
              }`}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(validate(e.target.value));
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder="e.g. coding-agent-base, researcher-stack"
            />
            {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
          </div>

          <div>
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Description (optional)
            </label>
            <textarea
              className="h-16 w-full resize-none rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 transition focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this group is for"
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
            <AlertTriangle
              size={14}
              className="mt-0.5 flex-shrink-0 text-amber-400"
            />
            <p className="text-[10px] leading-relaxed text-amber-300/80">
              When you insert this template, agent names get a{' '}
              <strong>(copy)</strong> suffix and storage / working
              directories get a unique sub-path so the new copy doesn't
              merge data with the original.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-3">
          <button
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={12} />
            Save Template
          </button>
        </div>
      </div>
    </div>
  );
}
