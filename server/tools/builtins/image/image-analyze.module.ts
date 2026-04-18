import { defineTool } from '../../tool-module';
import { createImageAnalyzeTool, type ImageAnalyzeContext } from './image-analyze';

export default defineTool<ImageAnalyzeContext>({
  name: 'image',
  label: 'Image',
  description: 'Load an image (from the workspace or a URL) so the model can analyze it',
  group: 'media',
  icon: 'image',
  classification: 'read-only',

  resolveContext: (_config, runtime) => ({ cwd: runtime.cwd }),
  create: (ctx) => createImageAnalyzeTool(ctx),
});
