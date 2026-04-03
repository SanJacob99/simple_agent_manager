import type { ThinkingLevel } from '../types/nodes';

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
  systemPrompt: string;
}

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  provider: 'anthropic',
  modelId: 'claude-sonnet-4-20250514',
  thinkingLevel: 'off',
  systemPrompt: 'You are a helpful assistant.',
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
