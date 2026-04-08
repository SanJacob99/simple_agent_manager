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
