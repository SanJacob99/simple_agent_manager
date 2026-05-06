import type { AgentTool } from '@mariozechner/pi-agent-core';
import { buildDocTools } from './sam-agent-doc-tools';
import { buildProposePatchTool, type ProposePatchToolContext } from './sam-agent-patch-tool';
import { buildSamAgentHitlTools, type SamAgentHitlRegistry } from './sam-agent-hitl';

export interface BuildSamAgentToolsParams {
  repoRoot: string;
  patchCtx: ProposePatchToolContext;
  hitlRegistry: SamAgentHitlRegistry;
}

export function buildSamAgentTools(params: BuildSamAgentToolsParams): AgentTool[] {
  return [
    ...buildDocTools(params.repoRoot),
    buildProposePatchTool(params.patchCtx),
    ...buildSamAgentHitlTools(params.hitlRegistry),
  ];
}
