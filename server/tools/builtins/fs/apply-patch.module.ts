import { defineTool } from '../../tool-module';
import { createApplyPatchTool } from './apply-patch';
import type { FsToolContext } from './read-file';

export default defineTool<FsToolContext>({
  name: 'apply_patch',
  label: 'Apply Patch',
  description: 'Apply a unified-diff patch to one or more files in the workspace',
  group: 'fs',
  icon: 'diff',
  classification: 'destructive',

  resolveContext: (_config, runtime) => ({
    cwd: runtime.cwd,
    sandboxWorkdir: runtime.sandboxWorkdir,
  }),
  create: (ctx) => createApplyPatchTool(ctx),
});
