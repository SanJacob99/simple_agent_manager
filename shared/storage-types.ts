import type { SubAgentSessionMeta } from './sub-agent-types';

export interface SessionSkillsSnapshot {
  version: number;
  prompt: string;
  skills: { name: string; requiredEnv: string[]; primaryEnv?: string }[];
  resolvedSkills: {
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    source?: string;
    disableModelInvocation?: boolean;
  }[];
}

export interface SessionSystemPromptReport {
  skills: {
    promptChars: number;
    entries: { name: string; blockChars: number }[];
  };
  tools: {
    listChars: number;
    schemaChars: number;
    entries: { name: string; summaryChars: number; schemaChars: number; propertyCount: number }[];
  };
}

export interface SessionStoreEntry {
  sessionKey: string;
  sessionId: string;
  agentId: string;
  sessionFile?: string;

  createdAt: string;
  updatedAt: string;

  chatType: 'direct' | 'group' | 'room';
  provider?: string;
  subject?: string;
  room?: string;
  space?: string;
  displayName?: string;

  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  sendPolicy?: string;

  providerOverride?: string;
  modelOverride?: string;
  authProfileOverride?: string;

  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Most recent non-cumulative context-window fill, in tokens. */
  contextTokens: number;
  /**
   * Per-section breakdown of the most recent context snapshot. Seeded
   * at session creation with a baseline (messages=0) so the UI can
   * render the prompt/skills/tools rows immediately on session open,
   * refreshed on every turn. See `shared/context-usage.ts`.
   */
  contextBreakdown?: import('./context-usage').ContextUsageBreakdown;
  /**
   * The system prompt exactly as pi-ai will send it to the provider,
   * broken into sections for UI display. Captured server-side after
   * all runtime-injected appends (workspace fallback, HITL
   * confirmation policy, bundled-skills-root substitution). This is
   * what `SystemPromptPreview` reads so the panel matches the Context
   * breakdown and the actual LLM input. See
   * `shared/agent-config.ResolvedSystemPrompt`.
   */
  resolvedSystemPrompt?: import('./agent-config').ResolvedSystemPrompt;
  cacheRead: number;
  cacheWrite: number;
  totalEstimatedCostUsd: number;

  skillsSnapshot?: SessionSkillsSnapshot;
  systemPromptReport?: SessionSystemPromptReport;

  compactionCount: number;
  memoryFlushAt?: string;
  memoryFlushCompactionCount?: number;
  parentSessionId?: string;

  /**
   * Sub-agent metadata for sub-sessions (sessionKey shape `sub:*` or wrapped
   * `agent:<id>:sub:*`). Mutable: status / sealed are updated
   * by RunCoordinator as the sub-session progresses. Immutable audit lives
   * on the parent's transcript as a `sam.sub_agent_spawn` custom entry.
   */
  subAgentMeta?: SubAgentSessionMeta;
}

export interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

export interface MemoryFileInfo {
  name: string;
  isEvergreen: boolean;
  date: string | null;
}

export interface MaintenanceReport {
  mode: 'warn' | 'enforce';
  prunedEntries: string[];
  orphanTranscripts: string[];
  archivedResets: string[];
  storeRotated: boolean;
  diskBefore: number;
  diskAfter: number;
  evictedForBudget: string[];
}

export interface ForkPoint {
  entryId: string;
  timestamp: string;
  branches: BranchInfo[];
}

export interface BranchInfo {
  branchId: string;
  label: string;
  preview: string;
  timestamp: string;
  entryCount: number;
}

export interface BranchTree {
  forkPoints: ForkPoint[];
  defaultPath: string[];
  totalEntries: number;
}

export interface SessionLineage {
  current: { sessionId: string; sessionKey: string; createdAt: string };
  ancestors: Array<{ sessionId: string; sessionKey: string; createdAt: string }>;
}
