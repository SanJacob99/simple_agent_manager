import type { Edge } from '@xyflow/react';
import type {
  AgentNodeData,
  AppNode,
  FlowNodeData,
  MCPNodeData,
  StorageNodeData,
  SubAgentNodeData,
  ToolsNodeData,
} from '../types/nodes';
import type { TemplateEdge, TemplateNode } from '../types/templates';
import { createEdgeId, createNodeId } from './id';

/**
 * Build a unique agent name by appending "(copy)", "(copy 2)", ... until
 * the result doesn't collide with a name already in the graph.
 */
function uniqueAgentName(base: string, takenLower: Set<string>): string {
  const trimmed = (base || 'agent').trim();
  let candidate = `${trimmed} (copy)`;
  let i = 2;
  while (takenLower.has(candidate.toLowerCase())) {
    candidate = `${trimmed} (copy ${i++})`;
  }
  return candidate;
}

/**
 * Append `/${suffix}` to a path, normalising trailing slashes so we don't
 * produce `~/.foo//abc`. Empty `path` becomes just the suffix segment.
 */
function appendPathSuffix(path: string, suffix: string): string {
  if (!path) return suffix;
  return path.replace(/\/+$/, '') + '/' + suffix;
}

/**
 * Mutate any node-data fields that would silently collide with the
 * original if two clones lived in the same canvas. The user's contract
 * is "same config as the original, but they cannot merge" — concretely
 * that means storage directories and working directories must be
 * distinct, and agent / sub-agent names must be unique.
 */
function fixupUniqueness(
  data: FlowNodeData,
  newNodeId: string,
  takenAgentNames: Set<string>,
  takenSubAgentNames: Set<string>,
): FlowNodeData {
  const shortId = newNodeId.replace(/^node_/, '').slice(0, 8);

  switch (data.type) {
    case 'agent': {
      const agent = data as AgentNodeData;
      const newName = uniqueAgentName(agent.name, takenAgentNames);
      takenAgentNames.add(newName.toLowerCase());
      return {
        ...agent,
        name: newName,
        nameConfirmed: true,
        workingDirectory: agent.workingDirectory
          ? appendPathSuffix(agent.workingDirectory, shortId)
          : '',
      };
    }
    case 'storage': {
      const storage = data as StorageNodeData;
      // Storage path always gets a unique suffix so two clones never
      // share session/memory data on disk.
      const basePath = storage.storagePath || '~/.simple-agent-manager/storage';
      return {
        ...storage,
        storagePath: appendPathSuffix(basePath, shortId),
        label: storage.label
          ? `${storage.label} (${shortId})`
          : `Storage (${shortId})`,
      };
    }
    case 'tools': {
      const tools = data as ToolsNodeData;
      const cwd = tools.toolSettings.exec.cwd;
      if (!cwd) return tools;
      return {
        ...tools,
        toolSettings: {
          ...tools.toolSettings,
          exec: {
            ...tools.toolSettings.exec,
            cwd: appendPathSuffix(cwd, shortId),
          },
        },
      };
    }
    case 'mcp': {
      const mcp = data as MCPNodeData;
      if (!mcp.cwd) return mcp;
      return { ...mcp, cwd: appendPathSuffix(mcp.cwd, shortId) };
    }
    case 'subAgent': {
      const sub = data as SubAgentNodeData;
      const baseName = sub.name?.trim() || `subagent_${shortId}`;
      let candidate = `${baseName} (copy)`;
      let i = 2;
      while (takenSubAgentNames.has(candidate.toLowerCase())) {
        candidate = `${baseName} (copy ${i++})`;
      }
      takenSubAgentNames.add(candidate.toLowerCase());
      return {
        ...sub,
        name: candidate,
        workingDirectory: sub.workingDirectory
          ? appendPathSuffix(sub.workingDirectory, shortId)
          : sub.workingDirectory,
      };
    }
    default:
      return data;
  }
}

interface CloneResult {
  nodes: AppNode[];
  edges: Edge[];
  /** Map from template-local IDs to freshly minted graph IDs. */
  idMap: Map<string, string>;
}

/**
 * Take a saved template's nodes/edges, mint fresh IDs, place them around
 * `origin`, and apply uniqueness fixups. Edges that reference nodes
 * outside the template are dropped. The existing graph is read only to
 * compute already-taken names.
 */
export function cloneTemplateContents(
  templateNodes: TemplateNode[],
  templateEdges: TemplateEdge[],
  existingNodes: AppNode[],
  origin: { x: number; y: number },
): CloneResult {
  const idMap = new Map<string, string>();
  for (const n of templateNodes) {
    idMap.set(n.id, createNodeId());
  }

  const takenAgentNames = new Set<string>(
    existingNodes
      .filter((n) => n.data.type === 'agent')
      .map((n) => ((n.data as AgentNodeData).name || '').toLowerCase())
      .filter((s) => s.length > 0),
  );
  const takenSubAgentNames = new Set<string>(
    existingNodes
      .filter((n) => n.data.type === 'subAgent')
      .map((n) => ((n.data as SubAgentNodeData).name || '').toLowerCase())
      .filter((s) => s.length > 0),
  );

  // Anchor the cluster at `origin` while preserving relative offsets so
  // the inserted group keeps the same shape it had when saved.
  let minX = Infinity;
  let minY = Infinity;
  for (const n of templateNodes) {
    if (n.position.x < minX) minX = n.position.x;
    if (n.position.y < minY) minY = n.position.y;
  }
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(minY)) minY = 0;

  const nodes: AppNode[] = templateNodes.map((tn) => {
    const newId = idMap.get(tn.id)!;
    const fixedData = fixupUniqueness(
      tn.data,
      newId,
      takenAgentNames,
      takenSubAgentNames,
    );
    return {
      id: newId,
      type: tn.type,
      position: {
        x: origin.x + (tn.position.x - minX),
        y: origin.y + (tn.position.y - minY),
      },
      data: fixedData,
    };
  });

  const edges: Edge[] = [];
  for (const te of templateEdges) {
    const source = idMap.get(te.source);
    const target = idMap.get(te.target);
    if (!source || !target) continue;
    edges.push({
      id: createEdgeId(source, target),
      source,
      target,
      type: 'data',
      animated: true,
    });
  }

  return { nodes, edges, idMap };
}
