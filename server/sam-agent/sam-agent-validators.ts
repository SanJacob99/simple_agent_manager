import type {
  WorkflowPatch,
  WorkflowPatchResult,
  GraphSnapshot,
  PatchValidationError,
} from '../../shared/sam-agent/workflow-patch';

const ALL_NODE_TYPES = new Set([
  'agent', 'memory', 'tools', 'skills', 'contextEngine', 'agentComm',
  'connectors', 'storage', 'vectorDatabase', 'cron', 'provider', 'mcp',
  'subAgent',
]);

const SUB_AGENT_ALLOWED_PERIPHERALS = new Set(['tools', 'provider', 'skills', 'mcp']);

interface ResolvedNode {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

interface ResolvedEdge {
  source: string;
  target: string;
}

function resolvePatch(patch: WorkflowPatch, current: GraphSnapshot): {
  nodes: Map<string, ResolvedNode>;
  edges: ResolvedEdge[];
  errors: PatchValidationError[];
} {
  const errors: PatchValidationError[] = [];
  const nodes = new Map<string, ResolvedNode>();

  for (const n of current.nodes) {
    nodes.set(n.id, { id: n.id, type: n.type, data: n.data });
  }

  for (const id of patch.remove_nodes) {
    if (!nodes.has(id)) {
      errors.push({ code: 'unknown_node_id', message: `remove_nodes: '${id}' not found`, path: id });
    }
  }

  for (const upd of patch.update_nodes) {
    if (patch.remove_nodes.includes(upd.id)) {
      errors.push({ code: 'update_then_remove', message: `update_nodes references '${upd.id}' which is also in remove_nodes`, path: upd.id });
      continue;
    }
    const existing = nodes.get(upd.id);
    if (!existing) {
      errors.push({ code: 'unknown_node_id', message: `update_nodes: '${upd.id}' not found`, path: upd.id });
      continue;
    }
    nodes.set(upd.id, { id: upd.id, type: existing.type, data: { ...existing.data, ...upd.dataPatch } });
  }

  for (const id of patch.remove_nodes) {
    nodes.delete(id);
  }

  for (const add of patch.add_nodes) {
    if (!ALL_NODE_TYPES.has(add.type)) {
      errors.push({ code: 'unknown_node_type', message: `add_nodes: type '${add.type}' is unknown`, path: add.tempId });
      continue;
    }
    if (nodes.has(add.tempId)) {
      errors.push({ code: 'duplicate_id', message: `add_nodes tempId '${add.tempId}' collides with existing node id`, path: add.tempId });
      continue;
    }
    nodes.set(add.tempId, { id: add.tempId, type: add.type, data: { type: add.type, ...add.data } as Record<string, unknown> });
  }

  const edges: ResolvedEdge[] = current.edges
    .filter((e) => !patch.remove_edges.includes(e.id))
    .map((e) => ({ source: e.source, target: e.target }));

  for (const eid of patch.remove_edges) {
    if (!current.edges.some((e) => e.id === eid)) {
      errors.push({ code: 'unknown_edge_id', message: `remove_edges: '${eid}' not found`, path: eid });
    }
  }

  for (const add of patch.add_edges) {
    if (!nodes.has(add.source)) {
      errors.push({ code: 'unknown_edge_endpoint', message: `add_edges source '${add.source}' is not a node id or tempId`, path: add.source });
      continue;
    }
    if (!nodes.has(add.target)) {
      errors.push({ code: 'unknown_edge_endpoint', message: `add_edges target '${add.target}' is not a node id or tempId`, path: add.target });
      continue;
    }
    edges.push({ source: add.source, target: add.target });
  }

  return { nodes, edges, errors };
}

function checkEdgeRules(
  nodes: Map<string, ResolvedNode>,
  edges: ResolvedEdge[],
): PatchValidationError[] {
  const errors: PatchValidationError[] = [];
  for (const edge of edges) {
    const target = nodes.get(edge.target);
    const source = nodes.get(edge.source);
    if (!target || !source) continue;

    const isAgent = target.type === 'agent';
    const isSubAgent = target.type === 'subAgent';
    if (!isAgent && !isSubAgent) {
      errors.push({
        code: 'invalid_edge',
        message: `Edge target must be 'agent' or 'subAgent' (got '${target.type}')`,
        path: `${edge.source}->${edge.target}`,
      });
      continue;
    }
    if (isSubAgent && !SUB_AGENT_ALLOWED_PERIPHERALS.has(source.type)) {
      errors.push({
        code: 'invalid_edge',
        message: `Sub-agent '${target.id}' cannot have a peripheral of type '${source.type}'. Allowed: tools, provider, skills, mcp.`,
        path: `${edge.source}->${edge.target}`,
      });
    }
  }
  return errors;
}

function checkAgentRunnable(
  nodes: Map<string, ResolvedNode>,
  edges: ResolvedEdge[],
  touchedAgentIds: Set<string>,
): PatchValidationError[] {
  const errors: PatchValidationError[] = [];
  for (const agentId of touchedAgentIds) {
    const agent = nodes.get(agentId);
    if (!agent || agent.type !== 'agent') continue;

    const peripherals = edges
      .filter((e) => e.target === agentId)
      .map((e) => nodes.get(e.source))
      .filter((n): n is ResolvedNode => !!n);

    const provider = peripherals.find((p) => p.type === 'provider');
    const storage = peripherals.find((p) => p.type === 'storage');
    const contextEngine = peripherals.find((p) => p.type === 'contextEngine');

    if (!provider) {
      errors.push({ code: 'agent_missing_provider', message: `Agent '${agentId}' has no connected provider`, path: agentId });
    } else if (!provider.data.pluginId || provider.data.pluginId === '') {
      errors.push({ code: 'agent_provider_incomplete', message: `Agent '${agentId}' provider has empty pluginId`, path: agentId });
    }
    if (!storage) {
      errors.push({ code: 'agent_missing_storage', message: `Agent '${agentId}' has no connected storage`, path: agentId });
    }
    if (!contextEngine) {
      errors.push({ code: 'agent_missing_context_engine', message: `Agent '${agentId}' has no connected contextEngine`, path: agentId });
    }
  }
  return errors;
}

export function validateWorkflowPatch(
  patch: WorkflowPatch,
  current: GraphSnapshot,
): WorkflowPatchResult {
  const { nodes, edges, errors: resolveErrors } = resolvePatch(patch, current);
  const edgeErrors = checkEdgeRules(nodes, edges);

  const touchedAgentIds = new Set<string>();
  for (const add of patch.add_nodes) if (add.type === 'agent') touchedAgentIds.add(add.tempId);
  for (const upd of patch.update_nodes) {
    const node = nodes.get(upd.id);
    if (node?.type === 'agent') touchedAgentIds.add(upd.id);
  }
  for (const e of patch.add_edges) {
    const target = nodes.get(e.target);
    if (target?.type === 'agent') touchedAgentIds.add(e.target);
  }
  const runnableErrors = checkAgentRunnable(nodes, edges, touchedAgentIds);

  const allErrors = [...resolveErrors, ...edgeErrors, ...runnableErrors];
  if (allErrors.length > 0) return { ok: false, errors: allErrors };
  return { ok: true, patch };
}
