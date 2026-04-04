export interface SessionMeta {
  sessionId: string;
  agentName: string;
  llmSlug: string;
  startedAt: string;
  updatedAt: string;
  sessionFile: string;
  skillsSnapshot?: {
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
  };
  contextTokens: number;
  systemPromptReport?: {
    skills: {
      promptChars: number;
      entries: { name: string; blockChars: number }[];
    };
    tools: {
      listChars: number;
      schemaChars: number;
      entries: { name: string; summaryChars: number; schemaChars: number; propertyCount: number }[];
    };
  };
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalEstimatedCostUsd: number;
  totalTokens: number;
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
