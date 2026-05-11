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

export function createVectorGetTool(ctx: VectorToolContext): AgentTool<TSchema> {
  return {
    name: 'vector_get',
    label: 'Vector Get',
    description:
      'Retrieve a single document from a vector collection by id (text + metadata, no similarity scoring).' +
      collectionDescriptionSuffix(ctx),
    parameters: Type.Object({
      id: Type.String({ description: 'Document id to retrieve' }),
      collection: Type.Optional(
        Type.String({
          description: 'Label of the vector collection to read from. Required when more than one is attached.',
        }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const engine = await resolveEngine(ctx, params.collection);
        const doc = await engine.get(params.id as string);
        if (!doc) return textResult(`No document found with id "${params.id}".`);
        return textResult(JSON.stringify(doc, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`vector_get failed: ${message}`);
      }
    },
  };
}
