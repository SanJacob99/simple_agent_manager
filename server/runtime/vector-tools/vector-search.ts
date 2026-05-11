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

export function createVectorSearchTool(ctx: VectorToolContext): AgentTool<TSchema> {
  return {
    name: 'vector_search',
    label: 'Vector Search',
    description:
      'Semantic search over a vector collection. Returns the top-K most similar documents by cosine distance (lower = closer).' +
      collectionDescriptionSuffix(ctx),
    parameters: Type.Object({
      query: Type.String({ description: 'Natural-language query to embed and match against the collection' }),
      topK: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 100,
          description: 'Maximum number of results to return (default 5)',
        }),
      ),
      collection: Type.Optional(
        Type.String({
          description: 'Label of the vector collection to search. Required when more than one is attached.',
        }),
      ),
    }),
    execute: async (_id, params: any) => {
      try {
        const engine = await resolveEngine(ctx, params.collection);
        const results = await engine.search(params.query, { topK: params.topK ?? 5 });
        if (results.length === 0) return textResult('No matches found.');
        return textResult(JSON.stringify(results, null, 2));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return textResult(`vector_search failed: ${message}`);
      }
    },
  };
}
