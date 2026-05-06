import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type } from '@sinclair/typebox';
import {
  isWorkflowPatch,
  type GraphSnapshot,
  type WorkflowPatch,
  type WorkflowPatchResult,
  type PatchValidationError,
} from '../../shared/sam-agent/workflow-patch';
import { validateWorkflowPatch } from './sam-agent-validators';

export interface ProposePatchToolContext {
  getSnapshot: () => GraphSnapshot;
}

const ADD_NODE_SCHEMA = Type.Object({
  tempId: Type.String({ description: 'Local id for this new node, used by add_edges to reference it. Must be unique within the patch. Do NOT use the field name "id" — only "tempId".' }),
  type: Type.String({ description: 'One of: agent, memory, tools, skills, contextEngine, agentComm, connectors, storage, vectorDatabase, cron, provider, mcp, subAgent.' }),
  position: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() })),
  data: Type.Object({}, { additionalProperties: true, description: 'Node-type-specific config. Must include the same `type` value as the node.' }),
});

const UPDATE_NODE_SCHEMA = Type.Object({
  id: Type.String({ description: 'Existing node id from the current_graph snapshot.' }),
  dataPatch: Type.Object({}, { additionalProperties: true, description: 'Partial update; shallow-merged onto the node\'s existing data.' }),
});

const ADD_EDGE_SCHEMA = Type.Object({
  source: Type.String({ description: 'Existing node id OR a tempId declared in add_nodes.' }),
  target: Type.String({ description: 'Existing node id OR a tempId declared in add_nodes. Must resolve to an agent or subAgent.' }),
});

const PATCH_TOOL_SCHEMA = Type.Object({
  add_nodes: Type.Array(ADD_NODE_SCHEMA),
  update_nodes: Type.Array(UPDATE_NODE_SCHEMA),
  remove_nodes: Type.Array(Type.String()),
  add_edges: Type.Array(ADD_EDGE_SCHEMA),
  remove_edges: Type.Array(Type.String()),
  rationale: Type.String(),
});

function patchResult(result: WorkflowPatchResult): AgentToolResult<null> {
  return { content: [{ type: 'text', text: JSON.stringify(result) }], details: null };
}

export function buildProposePatchTool(ctx: ProposePatchToolContext): AgentTool {
  return {
    name: 'propose_workflow_patch',
    label: 'Propose Workflow Patch',
    description:
      'Propose a workflow patch to the user. The patch is presented as an Apply card; the graph does not change until the user clicks Apply. ' +
      'Use one tool call per turn. Always include a short `rationale`. Use tempIds for new nodes so add_edges can reference them.',
    parameters: PATCH_TOOL_SCHEMA,
    execute: async (_toolCallId: string, params: unknown, _signal?: AbortSignal) => {
      if (!isWorkflowPatch(params)) {
        const result: WorkflowPatchResult = {
          ok: false,
          errors: [{ code: 'invalid_shape', message: 'parameters do not match the WorkflowPatch shape' }],
        };
        return patchResult(result);
      }
      const result = validateWorkflowPatch(params as WorkflowPatch, ctx.getSnapshot());
      return patchResult(result);
    },
  };
}
