import type { ThinkingLevel, CompactionStrategy, MemoryBackend } from '../types/nodes';
import type { SystemPromptMode } from '../../shared/agent-config';

export type AppView = 'canvas' | 'settings';

export type SettingsSectionId =
  | 'api-keys'
  | 'model-catalog'
  | 'defaults'
  | 'data-maintenance';

// --- Per-node-type defaults ---

export interface AgentDefaults {
  provider: string;
  modelId: string;
  thinkingLevel: ThinkingLevel;
  systemPromptMode: SystemPromptMode;
  systemPrompt: string;
  safetyGuardrails: string;
}

export interface StorageDefaults {
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  maintenanceMode: 'warn' | 'enforce';
  pruneAfterDays: number;
}

export interface ContextEngineDefaults {
  tokenBudget: number;
  reservedForResponse: number;
  compactionStrategy: CompactionStrategy;
  compactionThreshold: number;
  ragEnabled: boolean;
  ragTopK: number;
  ragMinScore: number;
}

export interface MemoryDefaults {
  backend: MemoryBackend;
  maxSessionMessages: number;
  persistAcrossSessions: boolean;
  compactionEnabled: boolean;
}

export interface CronDefaults {
  schedule: string;
  sessionMode: 'persistent' | 'ephemeral';
  timezone: string;
  maxRunDurationMs: number;
  retentionDays: number;
}

export type DefaultsSubTab = 'agent' | 'storage' | 'contextEngine' | 'memory' | 'cron';

// --- Default values ---

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
  provider: 'openrouter',
  modelId: 'anthropic/claude-sonnet-4-20250514',
  thinkingLevel: 'off',
  systemPromptMode: 'append',
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

export const DEFAULT_STORAGE_DEFAULTS: StorageDefaults = {
  storagePath: '~/.simple-agent-manager/storage',
  sessionRetention: 50,
  memoryEnabled: true,
  maintenanceMode: 'warn',
  pruneAfterDays: 30,
};

export const DEFAULT_CONTEXT_ENGINE_DEFAULTS: ContextEngineDefaults = {
  tokenBudget: 128000,
  reservedForResponse: 4096,
  compactionStrategy: 'trim-oldest',
  compactionThreshold: 0.8,
  ragEnabled: false,
  ragTopK: 5,
  ragMinScore: 0.7,
};

export const DEFAULT_MEMORY_DEFAULTS: MemoryDefaults = {
  backend: 'builtin',
  maxSessionMessages: 100,
  persistAcrossSessions: false,
  compactionEnabled: false,
};

export const DEFAULT_CRON_DEFAULTS: CronDefaults = {
  schedule: '0 9 * * *',
  sessionMode: 'persistent',
  timezone: 'local',
  maxRunDurationMs: 300000,
  retentionDays: 7,
};

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  description: string;
}> = [
  {
    id: 'api-keys',
    label: 'Providers & API Keys',
    description: 'Manage provider credentials saved to a local settings file.',
  },
  {
    id: 'model-catalog',
    label: 'Model Catalog',
    description: 'Inspect and refresh cached OpenRouter model discovery.',
  },
  {
    id: 'defaults',
    label: 'Defaults',
    description: 'Choose the defaults applied to newly created nodes.',
  },
  {
    id: 'data-maintenance',
    label: 'Data & Maintenance',
    description: 'Import, export, reset, and load fixture data.',
  },
];
