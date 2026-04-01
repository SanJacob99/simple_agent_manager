import type { GraphState } from '../types/graph';

const STORAGE_KEY = 'agent-manager-graph';

export function saveGraph(state: GraphState): void {
  try {
    const data = JSON.stringify({
      id: 'default',
      version: 1,
      graph: state,
      updatedAt: Date.now(),
    });
    localStorage.setItem(STORAGE_KEY, data);
  } catch {
    console.warn('Failed to save graph state');
  }
}

export function loadGraph(): GraphState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.graph ?? null;
  } catch {
    console.warn('Failed to load graph state');
    return null;
  }
}
