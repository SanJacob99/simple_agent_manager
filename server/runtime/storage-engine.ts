import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionStoreEntry, MemoryFileInfo } from '../../shared/storage-types';

export type { SessionStoreEntry, MemoryFileInfo };

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}\.md$/;

export class StorageEngine {
  private readonly agentDir: string;
  private readonly sessionsDir: string;
  private readonly memoryDir: string;
  private readonly memoryEnabled: boolean;
  private storeCache: Record<string, SessionStoreEntry> | null = null;

  constructor(
    private readonly config: ResolvedStorageConfig,
    private readonly agentName: string,
  ) {
    const resolvedPath = config.storagePath.startsWith('~')
      ? config.storagePath.replace('~', os.homedir())
      : config.storagePath;
    this.agentDir = path.join(resolvedPath, agentName);
    this.sessionsDir = path.join(this.agentDir, 'sessions');
    this.memoryDir = path.join(this.agentDir, 'memory');
    this.memoryEnabled = config.memoryEnabled;
  }

  async init(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    if (this.memoryEnabled) {
      await fs.mkdir(this.memoryDir, { recursive: true });
    }
  }

  getAgentDir(): string {
    return this.agentDir;
  }

  getSessionsDir(): string {
    return this.sessionsDir;
  }

  private storePath(): string {
    return path.join(this.sessionsDir, 'sessions.json');
  }

  private async readStore(): Promise<Record<string, SessionStoreEntry>> {
    if (this.storeCache) {
      return this.storeCache;
    }

    try {
      const raw = await fs.readFile(this.storePath(), 'utf-8');
      this.storeCache = JSON.parse(raw) as Record<string, SessionStoreEntry>;
    } catch {
      this.storeCache = {};
    }

    return this.storeCache;
  }

  private async writeStore(store: Record<string, SessionStoreEntry>): Promise<void> {
    this.storeCache = store;
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.writeFile(this.storePath(), JSON.stringify(store, null, 2), 'utf-8');
  }

  async listSessions(): Promise<SessionStoreEntry[]> {
    const store = await this.readStore();
    return Object.values(store).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async createSession(entry: SessionStoreEntry): Promise<void> {
    const store = await this.readStore();
    await this.writeStore({
      ...store,
      [entry.sessionKey]: entry,
    });
  }

  async getSession(sessionKey: string): Promise<SessionStoreEntry | null> {
    const store = await this.readStore();
    return store[sessionKey] ?? null;
  }

  async getSessionById(sessionId: string): Promise<SessionStoreEntry | null> {
    const store = await this.readStore();
    return Object.values(store).find((session) => session.sessionId === sessionId) ?? null;
  }

  async updateSession(
    sessionKey: string,
    partial: Partial<SessionStoreEntry>,
  ): Promise<void> {
    const store = await this.readStore();
    const existing = store[sessionKey];
    if (!existing) {
      return;
    }

    await this.writeStore({
      ...store,
      [sessionKey]: {
        ...existing,
        ...partial,
      },
    });
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const store = await this.readStore();
    const existing = store[sessionKey];
    if (!existing) {
      return;
    }

    const { [sessionKey]: _deleted, ...rest } = store;
    await this.writeStore(rest);
    await this.deleteTranscriptFile(existing);
  }

  async deleteAllSessions(): Promise<void> {
    const store = await this.readStore();
    await this.writeStore({});
    await Promise.all(
      Object.values(store).map((entry) => this.deleteTranscriptFile(entry)),
    );
  }

  resolveTranscriptPath(entry: Pick<SessionStoreEntry, 'sessionId' | 'sessionFile'>): string {
    if (!entry.sessionFile) {
      return path.join(this.sessionsDir, `${entry.sessionId}.jsonl`);
    }

    if (path.isAbsolute(entry.sessionFile)) {
      return entry.sessionFile;
    }

    return path.join(this.agentDir, entry.sessionFile);
  }

  async enforceRetention(maxSessions: number): Promise<void> {
    const sessions = await this.listSessions();
    if (sessions.length <= maxSessions) {
      return;
    }

    const overflow = sessions.slice(maxSessions);
    for (const session of overflow) {
      await this.deleteSession(session.sessionKey);
    }
  }

  async appendDailyMemory(content: string, date?: string): Promise<void> {
    const dateStr = date ?? new Date().toISOString().slice(0, 10);
    const filePath = path.join(this.memoryDir, `${dateStr}.md`);
    await fs.appendFile(filePath, content, 'utf-8');
  }

  async readDailyMemory(date: string): Promise<string | null> {
    const filePath = path.join(this.memoryDir, `${date}.md`);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async readLongTermMemory(): Promise<string | null> {
    const filePath = path.join(this.memoryDir, 'MEMORY.md');
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  async writeLongTermMemory(content: string): Promise<void> {
    const filePath = path.join(this.memoryDir, 'MEMORY.md');
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async listMemoryFiles(): Promise<MemoryFileInfo[]> {
    try {
      const entries = await fs.readdir(this.memoryDir);
      return entries
        .filter((entry) => entry.endsWith('.md'))
        .map((name) => {
          const isDateFile = DATE_REGEX.test(name);
          return {
            name,
            isEvergreen: !isDateFile,
            date: isDateFile ? name.replace('.md', '') : null,
          };
        });
    } catch {
      return [];
    }
  }

  private async deleteTranscriptFile(entry: Pick<SessionStoreEntry, 'sessionId' | 'sessionFile'>): Promise<void> {
    const transcriptPath = this.resolveTranscriptPath(entry);

    try {
      await fs.unlink(transcriptPath);
    } catch {
      // Ignore missing files so metadata cleanup stays idempotent.
    }
  }
}
