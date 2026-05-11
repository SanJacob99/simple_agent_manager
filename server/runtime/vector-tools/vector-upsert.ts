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

export function createVectorUpsertTool(ctx: VectorToolContext): AgentTool<TSchema> {
  return {
    name: 'vector_upsert',
    label: 'Vector Upsert',
    description:
      'Insert or update documents in a vector collection. Each document is embedded with the collection\'s configured embedding model and stored alongside its text and metadata.' +
      collectionDescriptionSuffix(ctx),
    parameters: Type.Object({
      documents: Type.Array(
        Type.Object({
          id: Type.String({ description: 'Stable unique id for this document' }),
          text: Type.String({ description: 'Document text to embed and store' }),
          metadata: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              description: 'Arbitrary JSON metadata returned alongside future search hits',
            }),
          ),
        }),
        { minItems: 1, description: 'Documents to insert or update (upsert by id)' },
      ),
      collection: Type.Optional(
        Type.String({
          description: 'Label of the vector collection to write to. Required when more than one is attached.',
        }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const engine = await resolveEngine(ctx, params.collection);
        const docs = (params.documents as Array<{
          id: string;
          text: string;
          metadata?: Record<string, unknown>;
        }>);
        const result = await engine.upsert(docs);
        return textResult(`Upserted ${result.inserted} document(s).`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`vector_upsert failed: ${message}`);
      }
    },
  };
}
