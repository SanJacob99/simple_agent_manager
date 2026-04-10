import type { AppNode, FlowNodeData } from '../types/nodes';
import type { Edge } from '@xyflow/react';
import type { SerializedGraph } from '../types/graph';
import { getDefaultNodeData } from './default-nodes';

export interface ExportedBundle {
  version: 2;
  exportedAt: number;
  graph: SerializedGraph;
}

/**
 * Export the current graph as a JSON bundle.
 */
export function exportGraph(nodes: AppNode[], edges: Edge[]): ExportedBundle {
  return {
    version: 2,
    exportedAt: Date.now(),
    graph: {
      id: 'exported',
      version: 2,
      graph: { nodes, edges },
      updatedAt: Date.now(),
    },
  };
}

/**
 * Import a graph bundle. Migrates old node data to current schema.
 */
export function importGraph(bundle: unknown): { nodes: AppNode[]; edges: Edge[] } | null {
  if (!bundle || typeof bundle !== 'object') return null;

  const b = bundle as Record<string, unknown>;

  // Support both bundle format and raw graph format
  let graphState: { nodes: AppNode[]; edges: Edge[] } | null = null;

  if (b.graph && typeof b.graph === 'object') {
    const g = b.graph as Record<string, unknown>;
    if (g.graph && typeof g.graph === 'object') {
      // Bundle format: { graph: { graph: { nodes, edges } } }
      graphState = g.graph as { nodes: AppNode[]; edges: Edge[] };
    } else if (Array.isArray(g.nodes)) {
      // Raw graph format: { graph: { nodes, edges } }
      graphState = g as unknown as { nodes: AppNode[]; edges: Edge[] };
    }
  } else if (Array.isArray(b.nodes)) {
    // Direct format: { nodes, edges }
    graphState = b as unknown as { nodes: AppNode[]; edges: Edge[] };
  }

  if (!graphState || !Array.isArray(graphState.nodes)) return null;

  // Migrate nodes: fill in default values for new fields
  const migratedNodes = graphState.nodes.map((node) => {
    const defaults = getDefaultNodeData(node.data.type);
    const merged = { ...defaults, ...node.data } as FlowNodeData;

    // Remove the pre-provider-node schema field from imported agent nodes.
    if (merged.type === 'agent' && 'provider' in merged) {
      delete (merged as FlowNodeData & { provider?: unknown }).provider;
    }

    // Auto-confirm names for imported agents that already have a name
    if (
      merged.type === 'agent' &&
      'nameConfirmed' in merged &&
      !(merged as any).nameConfirmed &&
      (merged as any).name
    ) {
      (merged as any).nameConfirmed = true;
    }

    return { ...node, data: merged };
  });

  return {
    nodes: migratedNodes,
    edges: graphState.edges || [],
  };
}

/**
 * Download a JSON file to the user's browser.
 */
export function downloadJson(data: unknown, filename: string) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Open a file picker and read JSON content.
 */
export function uploadJson(): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }
      try {
        const text = await file.text();
        resolve(JSON.parse(text));
      } catch (e) {
        reject(e);
      }
    };
    input.click();
  });
}
