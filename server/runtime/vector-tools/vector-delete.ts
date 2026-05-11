import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import {
  type VectorToolContext,
  collectionDescriptionSuffix,
  resolveEngine,
} from './shared-context';

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

export function createVectorDeleteTool(ctx: VectorToolContext): AgentTool<TSchema> {
  return {
    name: 'vector_delete',
    label: 'Vector Delete',
    description:
      'Delete documents from a vector collection by id.' +
      collectionDescriptionSuffix(ctx),
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        minItems: 1,
        description: 'Document ids to remove from the collection',
      }),
      collection: Type.Optional(
        Type.String({
          description: 'Label of the vector collection to delete from. Required when more than one is attached.',
        }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const engine = await resolveEngine(ctx, params.collection);
        const result = await engine.delete(params.ids as string[]);
        return textResult(`Deleted ${result.deleted} document(s).`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`vector_delete failed: ${message}`);
      }
    },
  };
}
