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

const PATCH_TOOL_SCHEMA = Type.Object({
  add_nodes: Type.Array(Type.Any()),
  update_nodes: Type.Array(Type.Any()),
  remove_nodes: Type.Array(Type.String()),
  add_edges: Type.Array(Type.Any()),
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
