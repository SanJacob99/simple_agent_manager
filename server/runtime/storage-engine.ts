import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionMeta, SessionEntry, MemoryFileInfo } from '../../shared/storage-types';
export type { SessionMeta, SessionEntry, MemoryFileInfo };

// --- Engine ---

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}\.md$/;

export class StorageEngine {
  private readonly agentDir: string;
  private readonly sessionsDir: string;
  private readonly memoryDir: string;
  private readonly memoryEnabled: boolean;
  private indexCache: SessionMeta[] | null = null;

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

  // --- Index I/O ---

  private indexPath(): string {
    return path.join(this.sessionsDir, '_index.json');
  }

  private async readIndex(): Promise<SessionMeta[]> {
    if (this.indexCache) return this.indexCache;
    try {
      const raw = await fs.readFile(this.indexPath(), 'utf-8');
      this.indexCache = JSON.parse(raw) as SessionMeta[];
    } catch {
      this.indexCache = [];
    }
    return this.indexCache;
  }

  private async writeIndex(sessions: SessionMeta[]): Promise<void> {
    this.indexCache = sessions;
    await fs.writeFile(this.indexPath(), JSON.stringify(sessions, null, 2), 'utf-8');
  }

  // --- Session CRUD ---

  async listSessions(): Promise<SessionMeta[]> {
    const sessions = await this.readIndex();
    return [...sessions].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async createSession(meta: SessionMeta): Promise<void> {
    const sessions = await this.readIndex();
    sessions.push(meta);
    await this.writeIndex(sessions);

    const jsonlPath = path.join(this.agentDir, meta.sessionFile);
    await fs.writeFile(jsonlPath, '', 'utf-8');
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessions = await this.readIndex();
    const session = sessions.find((s) => s.sessionId === sessionId);
    const filtered = sessions.filter((s) => s.sessionId !== sessionId);
    await this.writeIndex(filtered);

    if (session) {
      const jsonlPath = path.join(this.agentDir, session.sessionFile);
      try {
        await fs.unlink(jsonlPath);
      } catch {
        // File may already be gone
      }
    }
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    const sessions = await this.readIndex();
    return sessions.find((s) => s.sessionId === sessionId) ?? null;
  }

  async getSessionByKey(sessionKey: string): Promise<SessionMeta | null> {
    const sessions = await this.readIndex();
    return sessions.find((s) => s.sessionKey === sessionKey) ?? null;
  }

  async updateSessionMeta(sessionId: string, partial: Partial<SessionMeta>): Promise<void> {
    const sessions = await this.readIndex();
    const idx = sessions.findIndex((s) => s.sessionId === sessionId);
    if (idx === -1) return;
    sessions[idx] = { ...sessions[idx], ...partial };
    await this.writeIndex(sessions);
  }

  // --- JSONL entries ---

  async appendEntry(sessionId: string, entry: SessionEntry): Promise<void> {
    const meta = await this.getSessionMeta(sessionId);
    if (!meta) return;
    const jsonlPath = path.join(this.agentDir, meta.sessionFile);
    await fs.appendFile(jsonlPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  async readEntries(sessionId: string): Promise<SessionEntry[]> {
    const meta = await this.getSessionMeta(sessionId);
    if (!meta) return [];
    const jsonlPath = path.join(this.agentDir, meta.sessionFile);
    try {
      const raw = await fs.readFile(jsonlPath, 'utf-8');
      return raw
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as SessionEntry);
    } catch {
      return [];
    }
  }

  async replaceEntries(sessionId: string, entries: SessionEntry[]): Promise<void> {
    const meta = await this.getSessionMeta(sessionId);
    if (!meta) return;
    const jsonlPath = path.join(this.agentDir, meta.sessionFile);
    const serialized = entries.map((entry) => JSON.stringify(entry)).join('\n');
    await fs.writeFile(jsonlPath, serialized ? `${serialized}\n` : '', 'utf-8');
  }

  // --- Retention ---

  async enforceRetention(maxSessions: number): Promise<void> {
    const sessions = await this.listSessions();
    if (sessions.length <= maxSessions) return;

    const toRemove = sessions.slice(maxSessions);
    for (const session of toRemove) {
      await this.deleteSession(session.sessionId);
    }
  }

  // --- Memory ---

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
        .filter((e) => e.endsWith('.md'))
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
}
