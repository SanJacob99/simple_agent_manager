import type { GraphState } from '../types/graph';
import type { AppNode, FlowNodeData } from '../types/nodes';
import { getDefaultNodeData } from '../utils/default-nodes';

const STORAGE_KEY = 'agent-manager-graph';
const GRAPH_VERSION = 2;

/**
 * On-the-wire shape shared between localStorage and the backend. Mirrors
 * `PersistedGraph` in `server/storage/graph-file-store.ts` so the same
 * blob travels in both directions without remapping.
 */
export interface SerializedGraph {
  id: string;
  version: number;
  graph: GraphState;
  updatedAt: number;
}

function buildSerialized(state: GraphState): SerializedGraph {
  return {
    id: 'default',
    version: GRAPH_VERSION,
    graph: state,
    updatedAt: Date.now(),
  };
}

/**
 * Apply node-data migrations to a freshly loaded graph. Same behavior
 * as the previous localStorage path so nothing regresses for old data.
 */
function migrateGraph(graph: GraphState): GraphState {
  return {
    edges: graph.edges,
    nodes: graph.nodes.map((node: AppNode) => {
      const defaults = getDefaultNodeData(node.data.type);
      const merged = { ...defaults, ...node.data } as FlowNodeData;
      if (
        merged.type === 'agent'
        && 'nameConfirmed' in merged
        && !(merged as any).nameConfirmed
        && (merged as any).name
      ) {
        (merged as any).nameConfirmed = true;
      }
      return { ...node, data: merged };
    }),
  };
}

export function saveGraph(state: GraphState): void {
  try {
    const data = JSON.stringify(buildSerialized(state));
    localStorage.setItem(STORAGE_KEY, data);
  } catch {
    console.warn('Failed to save graph state');
  }
}

/**
 * Read the locally cached graph plus its `updatedAt` timestamp so the
 * boot sequence can reason about freshness vs. the backend copy.
 */
export function loadGraphRaw(): SerializedGraph | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SerializedGraph>;
    if (!parsed?.graph) return null;
    return {
      id: parsed.id ?? 'default',
      version: parsed.version ?? GRAPH_VERSION,
      graph: migrateGraph(parsed.graph),
      updatedAt: parsed.updatedAt ?? 0,
    };
  } catch {
    console.warn('Failed to load graph state');
    return null;
  }
}

export function loadGraph(): GraphState | null {
  return loadGraphRaw()?.graph ?? null;
}

/**
 * Fetch the canvas blob from the backend (the authoritative store).
 * Returns `null` if the server has nothing yet (first-run / migration
 * case) or if the network call fails — the boot flow falls back to
 * localStorage when this happens, then pushes that copy upstream.
 */
export async function fetchGraphFromServer(): Promise<SerializedGraph | null> {
  try {
    const res = await fetch('/api/graph');
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<SerializedGraph> | null;
    if (!data || !data.graph) return null;
    return {
      id: data.id ?? 'default',
      version: data.version ?? GRAPH_VERSION,
      graph: migrateGraph(data.graph),
      updatedAt: data.updatedAt ?? 0,
    };
  } catch {
    return null;
  }
}

/**
 * Push the current graph state to the backend. Errors are swallowed —
 * the next debounced save will retry, and localStorage already holds
 * the same blob so nothing is lost on a single failed network call.
 */
export async function saveGraphToServer(state: GraphState): Promise<void> {
  try {
    await fetch('/api/graph', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSerialized(state)),
    });
  } catch {
    // Server unreachable — localStorage cache survives until next save.
  }
}
