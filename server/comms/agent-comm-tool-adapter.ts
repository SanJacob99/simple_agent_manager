import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { TSchema } from '@sinclair/typebox';
import type { AgentCommTool } from './agent-comm-tools';

/**
 * Bridge `AgentCommTool` (the lightweight shape returned by
 * `createAgentCommTools`) into the `AgentTool<TSchema>` shape that
 * pi-agent-core's runtime expects. The conversion is structural — the
 * bus tools' JSON Schema parameters are accepted as-is — and the
 * `execute` callback is wrapped to return a canonical `AgentToolResult`
 * with the bus result serialized as a single `text` content block.
 *
 * Used by `RunCoordinator.dispatchChannel()` to inject the channel-mode
 * tools per-run without permanently touching the runtime's base tool list.
 */
export function adaptAgentCommTool(tool: AgentCommTool): AgentTool<TSchema> {
  const wrapped: AgentTool<TSchema> = {
    name: tool.name,
    description: tool.description,
    label: tool.name,
    parameters: tool.parameters as TSchema,
    execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      const result = await tool.execute(params);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
  return wrapped;
}

export function adaptAgentCommTools(tools: AgentCommTool[]): AgentTool<TSchema>[] {
  return tools.map(adaptAgentCommTool);
}
