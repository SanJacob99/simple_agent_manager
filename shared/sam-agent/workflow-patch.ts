export type NodeType =
  | 'agent' | 'memory' | 'tools' | 'skills' | 'contextEngine' | 'agentComm'
  | 'connectors' | 'storage' | 'vectorDatabase' | 'cron' | 'provider' | 'mcp'
  | 'subAgent';

export interface WorkflowPatchAddNode {
  tempId: string;
  type: NodeType;
  position?: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface WorkflowPatchUpdateNode {
  id: string;
  dataPatch: Record<string, unknown>;
}

export interface WorkflowPatchAddEdge {
  source: string;  // existing node id OR tempId
  target: string;
}

export interface WorkflowPatch {
  add_nodes: WorkflowPatchAddNode[];
  update_nodes: WorkflowPatchUpdateNode[];
  remove_nodes: string[];
  add_edges: WorkflowPatchAddEdge[];
  remove_edges: string[];
  rationale: string;
}

export interface PatchValidationError {
  code: string;
  message: string;
  path?: string;
}

export type WorkflowPatchResult =
  | { ok: true; patch: WorkflowPatch }
  | { ok: false; errors: PatchValidationError[] };

export interface SnapshotNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

export interface SnapshotEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphSnapshot {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|password|authorization|bearer)/i;

function redactValue(key: string, value: unknown): unknown {
  if (SECRET_KEY_PATTERN.test(key) && typeof value === 'string' && value.length > 0) {
    return '[redacted]';
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v);
    }
    return out;
  }
  return value;
}

function redactNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = redactValue(k, v);
  }
  return out;
}

export function redactGraphSnapshot(input: {
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown>; position?: unknown }>;
  edges: Array<{ id: string; source: string; target: string }>;
}): GraphSnapshot {
  return {
    nodes: input.nodes.map((n) => ({
      id: n.id,
      type: (n.data as { type?: string }).type ?? n.type ?? 'unknown',
      data: redactNodeData(n.data),
    })),
    edges: input.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  };
}

export function isWorkflowPatch(value: unknown): value is WorkflowPatch {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.add_nodes) &&
    Array.isArray(v.update_nodes) &&
    Array.isArray(v.remove_nodes) &&
    Array.isArray(v.add_edges) &&
    Array.isArray(v.remove_edges) &&
    typeof v.rationale === 'string'
  );
}
