/**
 * Catalog of every routable CSS color variable defined in app.css, grouped
 * for the Colors settings UI. Overrides are persisted to localStorage and
 * applied to :root as inline custom properties, which take precedence over
 * the values defined in app.css.
 */

export interface ColorVarDef {
  /** CSS variable name including leading -- */
  name: string;
  /** Human-readable label */
  label: string;
}

export interface ColorVarGroup {
  id: string;
  label: string;
  description?: string;
  vars: ColorVarDef[];
}

export const COLOR_GROUPS: ColorVarGroup[] = [
  {
    id: 'neutral',
    label: 'Neutral (Slate)',
    description: 'Backgrounds, borders, body text.',
    vars: [
      { name: '--c-slate-50', label: 'Slate 50' },
      { name: '--c-slate-100', label: 'Slate 100' },
      { name: '--c-slate-200', label: 'Slate 200' },
      { name: '--c-slate-300', label: 'Slate 300' },
      { name: '--c-slate-400', label: 'Slate 400' },
      { name: '--c-slate-500', label: 'Slate 500' },
      { name: '--c-slate-600', label: 'Slate 600' },
      { name: '--c-slate-700', label: 'Slate 700' },
      { name: '--c-slate-800', label: 'Slate 800' },
      { name: '--c-slate-900', label: 'Slate 900' },
      { name: '--c-slate-925', label: 'Slate 925' },
      { name: '--c-slate-950', label: 'Slate 950' },
    ],
  },
  {
    id: 'brand',
    label: 'Brand (Blue)',
    vars: [
      { name: '--c-blue-200', label: 'Blue 200' },
      { name: '--c-blue-300', label: 'Blue 300' },
      { name: '--c-blue-400', label: 'Blue 400' },
      { name: '--c-blue-500', label: 'Blue 500' },
      { name: '--c-blue-600', label: 'Blue 600' },
    ],
  },
  {
    id: 'danger',
    label: 'Danger (Red / Rose)',
    vars: [
      { name: '--c-red-200', label: 'Red 200' },
      { name: '--c-red-300', label: 'Red 300' },
      { name: '--c-red-400', label: 'Red 400' },
      { name: '--c-red-500', label: 'Red 500' },
      { name: '--c-red-600', label: 'Red 600' },
      { name: '--c-rose-400', label: 'Rose 400' },
    ],
  },
  {
    id: 'warning',
    label: 'Warning (Amber / Orange)',
    vars: [
      { name: '--c-amber-50', label: 'Amber 50' },
      { name: '--c-amber-200', label: 'Amber 200' },
      { name: '--c-amber-300', label: 'Amber 300' },
      { name: '--c-amber-400', label: 'Amber 400' },
      { name: '--c-amber-500', label: 'Amber 500' },
      { name: '--c-amber-600', label: 'Amber 600' },
      { name: '--c-orange-500', label: 'Orange 500' },
    ],
  },
  {
    id: 'success',
    label: 'Success (Green / Emerald)',
    vars: [
      { name: '--c-green-400', label: 'Green 400' },
      { name: '--c-emerald-200', label: 'Emerald 200' },
      { name: '--c-emerald-400', label: 'Emerald 400' },
      { name: '--c-emerald-500', label: 'Emerald 500' },
      { name: '--c-emerald-600', label: 'Emerald 600' },
    ],
  },
  {
    id: 'info',
    label: 'Info (Purple / Violet / Indigo)',
    vars: [
      { name: '--c-purple-50', label: 'Purple 50' },
      { name: '--c-purple-100', label: 'Purple 100' },
      { name: '--c-purple-200', label: 'Purple 200' },
      { name: '--c-purple-300', label: 'Purple 300' },
      { name: '--c-purple-400', label: 'Purple 400' },
      { name: '--c-purple-500', label: 'Purple 500' },
      { name: '--c-violet-200', label: 'Violet 200' },
      { name: '--c-violet-500', label: 'Violet 500' },
      { name: '--c-violet-600', label: 'Violet 600' },
      { name: '--c-indigo-400', label: 'Indigo 400' },
    ],
  },
  {
    id: 'nodes',
    label: 'Node Accents',
    description: 'Per-node-type accent color used on the canvas.',
    vars: [
      { name: '--c-node-agent', label: 'Agent' },
      { name: '--c-node-memory', label: 'Memory' },
      { name: '--c-node-tools', label: 'Tools' },
      { name: '--c-node-skills', label: 'Skills' },
      { name: '--c-node-context', label: 'Context Engine' },
      { name: '--c-node-comm', label: 'Agent Comm' },
      { name: '--c-node-connectors', label: 'Connectors' },
      { name: '--c-node-storage', label: 'Storage' },
      { name: '--c-node-vectordb', label: 'Vector DB' },
      { name: '--c-node-cron', label: 'Cron' },
      { name: '--c-node-provider', label: 'Provider' },
      { name: '--c-node-mcp', label: 'MCP' },
    ],
  },
  {
    id: 'surfaces',
    label: 'Surfaces',
    description: 'Special surfaces that bypass the Tailwind palette.',
    vars: [
      { name: '--c-canvas-bg', label: 'Canvas background' },
      { name: '--c-code-bg', label: 'Markdown code block' },
      { name: '--c-chat-input-bg', label: 'Chat session dropdown' },
    ],
  },
];

export const ALL_COLOR_VARS: ColorVarDef[] = COLOR_GROUPS.flatMap((g) => g.vars);

const STORAGE_KEY = 'sam:color-overrides';

export type ColorOverrides = Record<string, string>;

export function loadColorOverrides(): ColorOverrides {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as ColorOverrides;
  } catch {
    // ignore corrupt storage
  }
  return {};
}

export function saveColorOverrides(overrides: ColorOverrides): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // ignore quota errors
  }
}

export function applyColorOverrides(overrides: ColorOverrides): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const def of ALL_COLOR_VARS) {
    const value = overrides[def.name];
    if (value) {
      root.style.setProperty(def.name, value);
    } else {
      root.style.removeProperty(def.name);
    }
  }
}

/**
 * Convert any CSS color string the browser understands (oklch, rgb, hex, named)
 * to a #rrggbb hex string, by round-tripping through a canvas 2d context.
 * Used to seed `<input type="color">` with the current value of a CSS var.
 */
export function colorToHex(color: string): string {
  if (typeof document === 'undefined') return '#000000';
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return '#000000';
  ctx.fillStyle = '#000000';
  ctx.fillStyle = color;
  const normalized = ctx.fillStyle as string;
  if (normalized.startsWith('#')) return normalized;
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(normalized);
  if (match) {
    const toHex = (n: string) => Number(n).toString(16).padStart(2, '0');
    return `#${toHex(match[1])}${toHex(match[2])}${toHex(match[3])}`;
  }
  return '#000000';
}

/** Read the *current* resolved value of a CSS var on :root and convert to hex. */
export function readVarAsHex(name: string): string {
  if (typeof document === 'undefined') return '#000000';
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return '#000000';
  return colorToHex(raw);
}
