import { defineTool } from '../../tool-module';
import { resolveVectorContext, type VectorToolContext } from './shared-context';
import { createVectorGetTool } from './vector-get';

export default defineTool<VectorToolContext>({
  name: 'vector_get',
  label: 'Vector Get',
  description: 'Retrieve a single document from a vector collection by id.',
  group: 'vector',
  icon: 'file-search',
  classification: 'read-only',

  resolveContext: resolveVectorContext,
  create: (ctx) => {
    if (ctx.collections.length === 0) return null;
    return createVectorGetTool(ctx);
  },
});
