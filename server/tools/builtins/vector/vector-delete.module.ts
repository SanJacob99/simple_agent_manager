import { defineTool } from '../../tool-module';
import { resolveVectorContext, type VectorToolContext } from './shared-context';
import { createVectorDeleteTool } from './vector-delete';

export default defineTool<VectorToolContext>({
  name: 'vector_delete',
  label: 'Vector Delete',
  description: 'Delete documents from a vector collection by id.',
  group: 'vector',
  icon: 'trash-2',
  classification: 'destructive',

  resolveContext: resolveVectorContext,
  create: (ctx) => {
    if (ctx.collections.length === 0) return null;
    return createVectorDeleteTool(ctx);
  },
});
