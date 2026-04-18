import { defineTool } from '../../tool-module';
import { createListDirectoryTool } from './list-directory';
import type { FsToolContext } from './read-file';

export default defineTool<FsToolContext>({
  name: 'list_directory',
  label: 'List Directory',
  description: 'List the entries of a directory in the agent workspace',
  group: 'fs',
  icon: 'folder',
  classification: 'read-only',

  resolveContext: (_config, runtime) => ({
    cwd: runtime.cwd,
    sandboxWorkdir: runtime.sandboxWorkdir,
  }),
  create: (ctx) => createListDirectoryTool(ctx),
});
