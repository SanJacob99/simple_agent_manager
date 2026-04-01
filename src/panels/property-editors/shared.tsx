import type { ReactNode } from 'react';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

export const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30';

export const selectClass =
  'w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30';

export const textareaClass =
  'w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none';
