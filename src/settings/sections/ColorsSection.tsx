import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import {
  COLOR_GROUPS,
  ALL_COLOR_VARS,
  applyColorOverrides,
  loadColorOverrides,
  readVarAsHex,
  saveColorOverrides,
  type ColorOverrides,
  type ColorVarDef,
} from '../color-config';

export default function ColorsSection() {
  const [overrides, setOverrides] = useState<ColorOverrides>(() => loadColorOverrides());
  const [resolved, setResolved] = useState<Record<string, string>>({});

  // Seed each input with the currently-resolved hex (which already reflects
  // any overrides applied at boot).
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const def of ALL_COLOR_VARS) {
      next[def.name] = readVarAsHex(def.name);
    }
    setResolved(next);
  }, []);

  const updateColor = (name: string, hex: string) => {
    const next = { ...overrides, [name]: hex };
    setOverrides(next);
    setResolved((prev) => ({ ...prev, [name]: hex }));
    applyColorOverrides(next);
    saveColorOverrides(next);
  };

  const resetVar = (name: string) => {
    const next = { ...overrides };
    delete next[name];
    setOverrides(next);
    applyColorOverrides(next);
    saveColorOverrides(next);
    // Recompute the displayed hex from the now-restored CSS default.
    requestAnimationFrame(() => {
      setResolved((prev) => ({ ...prev, [name]: readVarAsHex(name) }));
    });
  };

  const resetAll = () => {
    setOverrides({});
    applyColorOverrides({});
    saveColorOverrides({});
    requestAnimationFrame(() => {
      const next: Record<string, string> = {};
      for (const def of ALL_COLOR_VARS) {
        next[def.name] = readVarAsHex(def.name);
      }
      setResolved(next);
    });
  };

  const overrideCount = Object.keys(overrides).length;

  return (
    <div className="max-w-3xl space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Theme Colors</h3>
            <p className="mt-1 text-sm text-slate-400">
              Every color used in the UI is routed through a CSS variable. Edit any
              swatch below to override the default. Changes apply instantly and
              persist locally in this browser.
            </p>
          </div>
          <button
            type="button"
            onClick={resetAll}
            disabled={overrideCount === 0}
            className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-600 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw size={12} />
            Reset all{overrideCount > 0 ? ` (${overrideCount})` : ''}
          </button>
        </header>
      </section>

      {COLOR_GROUPS.map((group) => (
        <section
          key={group.id}
          className="rounded-xl border border-slate-800 bg-slate-900/60 p-6"
        >
          <header className="mb-4">
            <h4 className="text-sm font-semibold text-slate-100">{group.label}</h4>
            {group.description && (
              <p className="mt-1 text-xs text-slate-500">{group.description}</p>
            )}
          </header>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.vars.map((def) => (
              <ColorRow
                key={def.name}
                def={def}
                value={resolved[def.name] ?? '#000000'}
                isOverridden={Boolean(overrides[def.name])}
                onChange={(hex) => updateColor(def.name, hex)}
                onReset={() => resetVar(def.name)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface ColorRowProps {
  def: ColorVarDef;
  value: string;
  isOverridden: boolean;
  onChange: (hex: string) => void;
  onReset: () => void;
}

function ColorRow({ def, value, isOverridden, onChange, onReset }: ColorRowProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-10 shrink-0 cursor-pointer rounded border border-slate-700 bg-transparent"
        aria-label={`${def.label} color picker`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-slate-200">{def.label}</div>
        <div className="truncate font-mono text-[10px] text-slate-500">{def.name}</div>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v);
        }}
        className="w-[78px] rounded border border-slate-700 bg-slate-900 px-1.5 py-1 font-mono text-[10px] text-slate-300 focus:border-slate-500 focus:outline-none"
      />
      {isOverridden && (
        <button
          type="button"
          onClick={onReset}
          title="Reset to default"
          className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
        >
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
}
