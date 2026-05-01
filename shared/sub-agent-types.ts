// shared/sub-agent-types.ts

export type SubAgentOverridableField =
  | 'modelId'
  | 'thinkingLevel'
  | 'systemPromptAppend'
  | 'enabledTools';

export const ALL_SUB_AGENT_OVERRIDABLE_FIELDS: readonly SubAgentOverridableField[] = [
  'modelId',
  'thinkingLevel',
  'systemPromptAppend',
  'enabledTools',
] as const;

/** The shape recorded on `SessionStoreEntry.subAgentMeta` for sub-sessions. */
export interface SubAgentSessionMeta {
  subAgentId: string;
  subAgentName: string;
  parentSessionKey: string;
  parentRunId: string;
  status: 'running' | 'completed' | 'error' | 'killed';
  sealed: boolean;
  appliedOverrides: Record<string, unknown>;
  modelId: string;
  providerPluginId: string;
  startedAt: number;
  endedAt?: number;
}

/** Sub-agent name validation regex; used by graph-to-agent and the parser helper. */
export const SUB_AGENT_NAME_REGEX = /^[a-z][a-z0-9_-]{0,31}$/;
