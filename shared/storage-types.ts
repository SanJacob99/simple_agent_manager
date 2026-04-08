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
  contextTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalEstimatedCostUsd: number;

  skillsSnapshot?: SessionSkillsSnapshot;
  systemPromptReport?: SessionSystemPromptReport;

  compactionCount: number;
  memoryFlushAt?: string;
  memoryFlushCompactionCount?: number;
  parentSessionId?: string;
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
