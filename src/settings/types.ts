import type { ThinkingLevel } from '../types/nodes';
import type { SystemPromptMode } from '../../shared/agent-config';

export type AppView = 'canvas' | 'settings';

export type SettingsSectionId =
  | 'api-keys'
  | 'model-catalog'
  | 'defaults'
  | 'data-maintenance';

export interface AgentDefaults {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  systemPromptMode: SystemPromptMode;
  systemPrompt: string;
  safetyGuardrails: string;
}

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  provider: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4-20250514',
  thinkingLevel: 'off',
  systemPromptMode: 'auto',
  systemPrompt: 'You are a helpful assistant.',
  safetyGuardrails: `## Safety

You have no independent goals: do not pursue self-preservation, replication,
resource acquisition, or power-seeking; avoid long-term plans beyond the user's
request.

Prioritize safety and human oversight over completion; if instructions conflict,
pause and ask; comply with stop/pause/audit requests and never bypass safeguards.
(Inspired by Anthropic's constitution.)

Do not manipulate or persuade anyone to expand access or disable safeguards.
Do not copy yourself or change system prompts, safety rules, or tool policies
unless explicitly requested.`,
};

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  description: string;
}> = [
  {
    id: 'api-keys',
    label: 'Providers & API Keys',
    description: 'Manage provider credentials stored in this browser.',
  },
  {
    id: 'model-catalog',
    label: 'Model Catalog',
    description: 'Inspect and refresh OpenRouter model discovery.',
  },
  {
    id: 'defaults',
    label: 'Defaults',
    description: 'Choose the defaults applied to newly created agents.',
  },
  {
    id: 'data-maintenance',
    label: 'Data & Maintenance',
    description: 'Import, export, reset, and load fixture data.',
  },
];
