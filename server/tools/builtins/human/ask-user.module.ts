import { defineTool } from '../../tool-module';
import { createAskUserTool, type AskUserContext } from './ask-user';

/**
 * ask_user tool module. The runtime context is provided wholesale by
 * `RuntimeHints.hitl` (built once per AgentRuntime and reused across
 * every HITL tool) — `resolveContext` just forwards it.
 */
export default defineTool<AskUserContext | undefined>({
  name: 'ask_user',
  label: 'Ask User',
  description:
    'Pause and ask the human a freeform question when you need information or clarification you cannot infer.',
  group: 'human',
  icon: 'help-circle',
  classification: 'read-only',

  resolveContext: (_config, runtime) => runtime.hitl,
  create: (ctx) => (ctx ? createAskUserTool(ctx) : null),
});
