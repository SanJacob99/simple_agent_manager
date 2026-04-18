import { defineTool } from '../../tool-module';
import { createReadFileTool, type FsToolContext } from './read-file';

export default defineTool<FsToolContext>({
  name: 'read_file',
  label: 'Read File',
  description: 'Read a UTF-8 text file from the agent workspace',
  group: 'fs',
  icon: 'file-text',
  classification: 'read-only',

  resolveContext: (_config, runtime) => ({
    cwd: runtime.cwd,
    sandboxWorkdir: runtime.sandboxWorkdir,
  }),
  create: (ctx) => createReadFileTool(ctx),
});
