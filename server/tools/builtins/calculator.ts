import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

export function createCalculatorTool(): AgentTool<TSchema> {
  return {
    name: 'calculator',
    description: 'Evaluate a mathematical expression safely.',
    label: 'Calculator',
    parameters: Type.Object({
      expression: Type.String({ description: 'Math expression to evaluate' }),
    }),
    execute: async (_id, params: any) => {
      try {
        const expr = params.expression as string;

        // SECURITY: Prevent Remote Code Execution (RCE)
        // Validate expression contains only mathematical characters
        if (!/^[0-9+\-/*%().\s]+$/.test(expr)) {
          return textResult('Error: Invalid characters in expression. Only numbers and basic math operators are allowed.');
        }

        // Simple safe math eval using Function constructor with no scope
        const result = new Function(`"use strict"; return (${expr})`)();
        return textResult(String(result));
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : 'Invalid expression'}`);
      }
    },
  };
}
