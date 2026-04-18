import { defineTool } from '../../tool-module';
import { createWriteFileTool } from './write-file';
import type { FsToolContext } from './read-file';

export default defineTool<FsToolContext>({
  name: 'write_file',
  label: 'Write File',
  description: 'Write a UTF-8 text file into the agent workspace',
  group: 'fs',
  icon: 'file-plus',
  classification: 'state-mutating',

  resolveContext: (_config, runtime) => ({
    cwd: runtime.cwd,
    sandboxWorkdir: runtime.sandboxWorkdir,
  }),
  create: (ctx) => createWriteFileTool(ctx),
});
