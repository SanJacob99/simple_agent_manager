import { defineTool } from '../../tool-module';
import { resolveVectorContext, type VectorToolContext } from './shared-context';
import { createVectorSearchTool } from './vector-search';

export default defineTool<VectorToolContext>({
  name: 'vector_search',
  label: 'Vector Search',
  description: 'Semantic search over a vector collection (top-K nearest neighbours).',
  group: 'vector',
  icon: 'search',
  classification: 'read-only',

  resolveContext: resolveVectorContext,
  create: (ctx) => {
    if (ctx.collections.length === 0) return null;
    return createVectorSearchTool(ctx);
  },
});
