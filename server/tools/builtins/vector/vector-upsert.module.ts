import { defineTool } from '../../tool-module';
import { resolveVectorContext, type VectorToolContext } from './shared-context';
import { createVectorUpsertTool } from './vector-upsert';

export default defineTool<VectorToolContext>({
  name: 'vector_upsert',
  label: 'Vector Upsert',
  description: 'Insert or update documents (with embeddings) in a vector collection.',
  group: 'vector',
  icon: 'database',
  classification: 'state-mutating',

  resolveContext: resolveVectorContext,
  create: (ctx) => {
    if (ctx.collections.length === 0) return null;
    return createVectorUpsertTool(ctx);
  },
});
