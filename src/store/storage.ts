import type { GraphState } from '../types/graph';
import type { AppNode, FlowNodeData } from '../types/nodes';
import { getDefaultNodeData } from '../utils/default-nodes';

const STORAGE_KEY = 'agent-manager-graph';

export function saveGraph(state: GraphState): void {
  try {
    const data = JSON.stringify({
      id: 'default',
      version: 2,
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
    const graph = parsed.graph as GraphState | undefined;
    if (!graph) return null;

    // Migrate nodes: fill in default values for new fields
    graph.nodes = graph.nodes.map((node: AppNode) => {
      const defaults = getDefaultNodeData(node.data.type);
      return {
        ...node,
        data: { ...defaults, ...node.data } as FlowNodeData,
      };
    });

    return graph;
  } catch {
    console.warn('Failed to load graph state');
    return null;
  }
}
