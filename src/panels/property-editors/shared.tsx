import { useState, useRef } from 'react';
import type { ReactNode } from 'react';

export function Field({ label, children, tooltip }: { label: string; children: ReactNode; tooltip?: string }) {
  return (
    <div className="mb-3">
      <label className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
        {tooltip && (
          <Tooltip text={tooltip}>
            <span className="cursor-help text-slate-500 hover:text-slate-300">?</span>
          </Tooltip>
        )}
      </label>
      {children}
    </div>
  );
}

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-normal rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-[10px] leading-relaxed text-slate-300 shadow-lg"
             style={{ width: 220 }}>
          {text}
          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-600" />
        </div>
      )}
    </div>
  );
}

export const inputClass =
  'w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30';

export const selectClass =
  'w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30';

export const textareaClass =
  'w-full rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none';
