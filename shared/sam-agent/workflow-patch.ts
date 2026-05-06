// Mirrors src/types/nodes.ts NodeType. Keep in sync — shared/ cannot import from src/ (see CLAUDE.md "Conventions").
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

const SECRET_KEY_PATTERN = /^(api[_-]?key|api[_-]?keys|secret|secrets|token|tokens|password|passwords|authorization|bearer|access[_-]?token|refresh[_-]?token|api[_-]?token)$/i;

function redact(value: unknown, inSecretContext: boolean): unknown {
  if (inSecretContext && typeof value === 'string' && value.length > 0) {
    return '[redacted]';
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, inSecretContext));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const shouldRedact = inSecretContext || SECRET_KEY_PATTERN.test(k);
      out[k] = redact(v, shouldRedact);
    }
    return out;
  }
  return value;
}

/** Strips React Flow positions and masks secret-keyed fields. Positions are intentionally dropped — the LLM doesn't need them and Task 3 computes layout for new nodes. */
export function redactGraphSnapshot(input: {
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown>; position?: unknown }>;
  edges: Array<{ id?: string; source: string; target: string }>;
}): GraphSnapshot {
  return {
    nodes: input.nodes.map((n) => ({
      id: n.id,
      // Fallback chain: data.type (most authoritative) → React Flow node.type → 'unknown' (defensive — should never trigger).
      type: (n.data as { type?: string }).type ?? n.type ?? 'unknown',
      data: redact(n.data, false) as Record<string, unknown>,
    })),
    edges: input.edges.map((e, i) => ({
      id: e.id ?? `edge_${i}_${e.source}_${e.target}`,
      source: e.source,
      target: e.target,
    })),
  };
}

/** Shallow shape check. Use validateWorkflowPatch() for full validation. */
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
