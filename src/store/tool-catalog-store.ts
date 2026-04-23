/**
 * Live tool catalog, fetched from `GET /api/tools` at app mount.
 *
 * The Tools-node picker reads from this store so it can display every
 * ToolModule registered server-side — including user-installed ones
 * under `server/tools/user/` (see `docs/concepts/user-tools-guide.md`).
 *
 * Offline fallback: when the backend is unreachable (or the store
 * hasn't loaded yet), `entriesOrFallback()` returns synthetic entries
 * built from `ALL_TOOL_NAMES` so the picker keeps working with the
 * built-in list. Callers that want to know "has real data arrived?"
 * should check `loaded`.
 */

import { create } from 'zustand';
import type { ToolCatalogEntry, ToolCatalogResponse } from '../../shared/tool-catalog';
import { ALL_TOOL_NAMES, TOOL_GROUPS } from '../../shared/resolve-tool-names';

interface ToolCatalogState {
  tools: ToolCatalogEntry[];
  /** True once a successful fetch has populated `tools`. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
  loadToolCatalog: () => Promise<void>;
  /**
   * Returns the live catalog when it has loaded, otherwise synthesises a
   * minimal entry for every name in `ALL_TOOL_NAMES` so the picker can
   * still render something during the initial fetch or when offline.
   */
  entriesOrFallback: () => ToolCatalogEntry[];
}

// Build a name -> group lookup from the shared TOOL_GROUPS map so the
// offline fallback still groups entries correctly in the picker.
const FALLBACK_GROUP_BY_NAME = (() => {
  const m = new Map<string, string>();
  for (const [group, names] of Object.entries(TOOL_GROUPS)) {
    for (const name of names) if (!m.has(name)) m.set(name, group);
  }
  return m;
})();

const FALLBACK_ENTRIES: ToolCatalogEntry[] = ALL_TOOL_NAMES.map((name) => ({
  name,
  label: name,
  description: '',
  group: FALLBACK_GROUP_BY_NAME.get(name),
}));

export const useToolCatalogStore = create<ToolCatalogState>((set, get) => ({
  tools: [],
  loaded: false,
  loading: false,
  error: null,

  loadToolCatalog: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/tools');
      if (!res.ok) throw new Error(`Failed to load tools: ${res.status}`);
      const tools = (await res.json()) as ToolCatalogResponse;
      set({ tools, loaded: true, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  entriesOrFallback: () => {
    const { tools, loaded } = get();
    return loaded && tools.length > 0 ? tools : FALLBACK_ENTRIES;
  },
}));
