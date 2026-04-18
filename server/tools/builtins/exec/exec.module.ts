import { defineTool } from '../../tool-module';
import { createExecTool, type ExecToolContext } from './exec';

/**
 * `exec` — shell execution with sandboxing and blocked-pattern safety.
 * `bash` is an alias resolved in `tool-factory.ts` before the registry
 * lookup; both user-facing names produce the same underlying tool.
 */
export default defineTool<ExecToolContext>({
  name: 'exec',
  label: 'Shell / Exec',
  description: 'Execute a shell command in the agent workspace',
  group: 'runtime',
  icon: 'terminal',
  classification: 'destructive',

  resolveContext: (_config, runtime) => ({
    cwd: runtime.cwd,
    sandboxWorkdir: runtime.sandboxWorkdir,
  }),
  create: (ctx) => createExecTool(ctx),
});
