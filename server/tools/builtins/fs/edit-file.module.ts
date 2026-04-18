import { defineTool } from '../../tool-module';
import { createEditFileTool } from './edit-file';
import type { FsToolContext } from './read-file';

export default defineTool<FsToolContext>({
  name: 'edit_file',
  label: 'Edit File',
  description: 'Apply a targeted find/replace edit to a UTF-8 text file',
  group: 'fs',
  icon: 'file-edit',
  classification: 'state-mutating',

  resolveContext: (_config, runtime) => ({
    cwd: runtime.cwd,
    sandboxWorkdir: runtime.sandboxWorkdir,
  }),
  create: (ctx) => createEditFileTool(ctx),
});
