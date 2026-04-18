import { defineTool } from '../../tool-module';
import { createShowImageTool, type ShowImageContext } from './show-image';

export default defineTool<ShowImageContext>({
  name: 'show_image',
  label: 'Show Image',
  description: 'Display an image from the workspace (or a URL) in the chat transcript',
  group: 'media',
  icon: 'image',
  classification: 'read-only',

  resolveContext: (_config, runtime) => ({ cwd: runtime.cwd }),
  create: (ctx) => createShowImageTool(ctx),
});
