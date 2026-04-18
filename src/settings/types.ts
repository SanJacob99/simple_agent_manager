import type { ThinkingLevel, CompactionStrategy, MemoryBackend } from '../types/nodes';
import type { SystemPromptMode } from '../../shared/agent-config';

export type AppView = 'canvas' | 'settings';

export type SettingsSectionId =
  | 'api-keys'
  | 'model-catalog'
  | 'defaults'
  | 'safety'
  | 'appearance'
  | 'colors'
  | 'data-maintenance';

// --- Per-node-type defaults ---

export interface AgentDefaults {
  modelId: string;
  thinkingLevel: ThinkingLevel;
  systemPromptMode: SystemPromptMode;
  systemPrompt: string;
  safetyGuardrails: string;
}

export interface ProviderDefaults {
  pluginId: string;
  authMethodId: string;
  envVar: string;
  baseUrl: string;
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

export interface ChatUIDefaults {
  /** Characters per second revealed while an assistant message is streaming. */
  textRevealCharsPerSec: number;
  /** Duration in ms of the per-character opacity fade. */
  textRevealFadeMs: number;
  /** Whether to animate the character reveal at all. */
  textRevealEnabled: boolean;
  /** Rendering strategy while streaming: per-block structural reveal, or flat char reveal. */
  textRevealStructure: 'blocks' | 'flat';
}

export type DefaultsSubTab =
  | 'agent'
  | 'provider'
  | 'storage'
  | 'contextEngine'
  | 'memory'
  | 'cron';

// --- Default values ---

export const DEFAULT_AGENT_DEFAULTS: AgentDefaults = {
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

export const DEFAULT_PROVIDER_DEFAULTS: ProviderDefaults = {
  pluginId: 'openrouter',
  authMethodId: 'api-key',
  envVar: 'OPENROUTER_API_KEY',
  baseUrl: '',
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

export const DEFAULT_CHAT_UI_DEFAULTS: ChatUIDefaults = {
  textRevealCharsPerSec: 90,
  textRevealFadeMs: 320,
  textRevealEnabled: true,
  textRevealStructure: 'blocks',
};

// --- Safety (HITL) ---

export interface SafetySettings {
  /**
   * Controls whether the Tools node's HITL checkboxes (ask_user,
   * confirm_action) can be unchecked. Default false: they stay locked on,
   * protecting the user even when they add agent tools that can damage
   * the system or reach the network. Flipping this to true is the explicit
   * "Dangerous Fully Auto" mode — the user takes responsibility.
   */
  allowDisableHitl: boolean;
  /**
   * Markdown policy block appended to every agent's system prompt when a
   * HITL tool is enabled. User-editable so teams can tune tone and scope.
   */
  confirmationPolicy: string;
}

export const DEFAULT_CONFIRMATION_POLICY = `## Confirmation policy

Before calling a state-mutating or destructive tool you MUST first call \`confirm_action\` with a short yes/no question summarizing what you are about to do, and wait for the answer. Read-only tools (search, read, list, calculator) do NOT require confirmation — call them freely.

RULES:
1. The confirmation call MUST be the ONLY tool call in that turn. Do NOT emit any other tool call alongside \`confirm_action\` — wait for the answer, then act on it in your next turn.
2. If the answer is "no" or the call is cancelled/timed out, you MUST abandon the action. Report what you would have done and stop.
3. If you need freeform input from the user (not yes/no), call \`ask_user\` instead — this also satisfies the gate for the subsequent action you described.
4. For destructive tools, include the concrete impact in the confirmation question (exact command, affected paths) — e.g. "I want to run \`rm -rf ./build\` — proceed?".
5. Exception: you do NOT need confirmation for calling \`ask_user\` or \`confirm_action\` themselves.

The "Tool confirmation matrix" block that follows lists which of your tools are read-only, state-mutating, and destructive. Treat that list as the ground truth for when confirmation is required.`;

export const DEFAULT_SAFETY_SETTINGS: SafetySettings = {
  allowDisableHitl: false,
  confirmationPolicy: DEFAULT_CONFIRMATION_POLICY,
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
    description: 'Inspect and refresh cached provider model discovery.',
  },
  {
    id: 'defaults',
    label: 'Defaults',
    description: 'Choose the defaults applied to newly created nodes.',
  },
  {
    id: 'safety',
    label: 'Safety',
    description: 'Human-in-the-loop confirmation policy and tool-lock controls.',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Chat UI preferences like text reveal animation speed.',
  },
  {
    id: 'colors',
    label: 'Colors',
    description: 'Override any routed CSS color variable used across the app.',
  },
  {
    id: 'data-maintenance',
    label: 'Data & Maintenance',
    description: 'Import, export, reset, and load fixture data.',
  },
];
