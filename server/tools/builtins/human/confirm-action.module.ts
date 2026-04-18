import { defineTool } from '../../tool-module';
import { createConfirmActionTool, type ConfirmActionContext } from './confirm-action';

/**
 * confirm_action tool module. Same pattern as ask_user — the HITL context
 * is shared across both tools and forwarded via `RuntimeHints.hitl`.
 */
export default defineTool<ConfirmActionContext | undefined>({
  name: 'confirm_action',
  label: 'Confirm Action',
  description:
    'Ask the human for a strict yes/no confirmation before performing a destructive, irreversible, or state-mutating action.',
  group: 'human',
  icon: 'shield-check',
  classification: 'read-only',

  resolveContext: (_config, runtime) => runtime.hitl,
  create: (ctx) => (ctx ? createConfirmActionTool(ctx) : null),
});
