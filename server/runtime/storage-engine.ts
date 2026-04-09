import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionStoreEntry, MemoryFileInfo, MaintenanceReport } from '../../shared/storage-types';

export type { SessionStoreEntry, MemoryFileInfo, MaintenanceReport };

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}\.md$/;

export class StorageEngine {
  private readonly agentDir: string;
  private readonly sessionsDir: string;
  private readonly memoryDir: string;
  private readonly memoryEnabled: boolean;
  private storeCache: Record<string, SessionStoreEntry> | null = null;

  private _safeJoin(base: string, target: string): string {
    const resolvedBase = path.resolve(base);
    const resolvedTarget = path.resolve(resolvedBase, target);
    if (!resolvedTarget.startsWith(resolvedBase + path.sep) && resolvedTarget !== resolvedBase) {
      throw new Error('Path traversal detected');
    }
    return resolvedTarget;
  }

  constructor(
    private readonly config: ResolvedStorageConfig,
    private readonly agentName: string,
  ) {
    const resolvedPath = config.storagePath.startsWith('~')
      ? config.storagePath.replace('~', os.homedir())
      : config.storagePath;
    this.agentDir = this._safeJoin(resolvedPath, agentName);
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
      return this._safeJoin(this.sessionsDir, `${entry.sessionId}.jsonl`);
    }

    if (path.isAbsolute(entry.sessionFile)) {
      return entry.sessionFile;
    }

    return this._safeJoin(this.agentDir, entry.sessionFile);
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

  async getDiskUsage(): Promise<number> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      let total = 0;
      for (const file of files) {
        try {
          const stat = await fs.stat(path.join(this.sessionsDir, file));
          if (stat.isFile()) {
            total += stat.size;
          }
        } catch {
          // Ignore files that disappear between readdir and stat
        }
      }
      return total;
    } catch {
      return 0;
    }
  }

  async pruneStaleEntries(pruneAfterDays: number, dryRun: boolean): Promise<string[]> {
    const store = await this.readStore();
    const threshold = Date.now() - pruneAfterDays * 24 * 60 * 60 * 1000;
    const staleKeys: string[] = [];

    for (const [key, entry] of Object.entries(store)) {
      if (new Date(entry.updatedAt).getTime() < threshold) {
        staleKeys.push(key);
      }
    }

    if (!dryRun) {
      for (const key of staleKeys) {
        await this.deleteSession(key);
      }
    }

    return staleKeys;
  }

  async removeOrphanTranscripts(dryRun: boolean): Promise<string[]> {
    const store = await this.readStore();

    // Build set of referenced transcript filenames (basename only)
    const referenced = new Set<string>();
    for (const entry of Object.values(store)) {
      const resolved = this.resolveTranscriptPath(entry);
      referenced.add(path.basename(resolved));
    }

    let files: string[];
    try {
      files = await fs.readdir(this.sessionsDir);
    } catch {
      return [];
    }

    const orphans: string[] = [];
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      if (!referenced.has(file)) {
        orphans.push(file);
        if (!dryRun) {
          try {
            await fs.unlink(path.join(this.sessionsDir, file));
          } catch {
            // Ignore
          }
        }
      }
    }

    return orphans;
  }

  async cleanResetArchives(retentionDays: number, dryRun: boolean): Promise<string[]> {
    if (retentionDays <= 0) return [];

    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const removed: string[] = [];

    let files: string[];
    try {
      files = await fs.readdir(this.sessionsDir);
    } catch {
      return [];
    }

    for (const file of files) {
      // Match *.reset.* pattern
      if (!file.includes('.reset.')) continue;
      const filePath = path.join(this.sessionsDir, file);
      try {
        const stat = await fs.stat(filePath);
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          removed.push(filePath);
          if (!dryRun) {
            await fs.unlink(filePath);
          }
        }
      } catch {
        // Ignore
      }
    }

    return removed;
  }

  async rotateStoreFile(maxBytes: number, dryRun: boolean): Promise<boolean> {
    const storeFilePath = this.storePath();

    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(storeFilePath);
    } catch {
      return false;
    }

    if (stat.size <= maxBytes) {
      return false;
    }

    if (!dryRun) {
      const timestamp = Date.now();
      const bakPath = path.join(this.sessionsDir, `sessions.${timestamp}.json.bak`);
      await fs.rename(storeFilePath, bakPath);
      this.storeCache = null;
      await this.writeStore({});
    }

    return true;
  }

  async enforceDiskBudget(maxBytes: number, highWaterBytes: number, dryRun: boolean): Promise<string[]> {
    if (maxBytes <= 0) {
      return [];
    }

    const usage = await this.getDiskUsage();
    if (usage <= maxBytes) {
      return [];
    }

    // First pass: remove orphan transcripts
    await this.removeOrphanTranscripts(dryRun);

    // Re-check usage after orphan removal
    let currentUsage = await this.getDiskUsage();
    const evicted: string[] = [];

    if (currentUsage > highWaterBytes) {
      // Evict oldest sessions by updatedAt until under highWaterBytes
      const sessions = await this.listSessions();
      // listSessions returns newest-first, so reverse for oldest-first
      const oldest = [...sessions].reverse();

      for (const session of oldest) {
        if (currentUsage <= highWaterBytes) break;
        evicted.push(session.sessionKey);
        if (!dryRun) {
          await this.deleteSession(session.sessionKey);
        }
        currentUsage = await this.getDiskUsage();
      }
    }

    return evicted;
  }

  async runMaintenance(mode?: 'warn' | 'enforce'): Promise<MaintenanceReport> {
    const effectiveMode = mode ?? this.config.maintenanceMode;
    const dryRun = effectiveMode === 'warn';

    const diskBefore = await this.getDiskUsage();

    const prunedEntries = await this.pruneStaleEntries(this.config.pruneAfterDays, dryRun);
    const orphanTranscripts = await this.removeOrphanTranscripts(dryRun);
    const archivedResets = await this.cleanResetArchives(this.config.resetArchiveRetentionDays, dryRun);

    // Enforce maxEntries limit
    if (!dryRun && this.config.maxEntries > 0) {
      const sessions = await this.listSessions();
      if (sessions.length > this.config.maxEntries) {
        const overflow = [...sessions].reverse().slice(0, sessions.length - this.config.maxEntries);
        for (const session of overflow) {
          await this.deleteSession(session.sessionKey);
        }
      }
    }

    const storeRotated = await this.rotateStoreFile(this.config.rotateBytes, dryRun);

    const highWaterBytes = this.config.maxDiskBytes > 0
      ? Math.floor(this.config.maxDiskBytes * this.config.highWaterPercent / 100)
      : 0;
    const evictedForBudget = await this.enforceDiskBudget(this.config.maxDiskBytes, highWaterBytes, dryRun);

    const diskAfter = await this.getDiskUsage();

    return {
      mode: effectiveMode,
      prunedEntries,
      orphanTranscripts,
      archivedResets,
      storeRotated,
      diskBefore,
      diskAfter,
      evictedForBudget,
    };
  }

  async appendDailyMemory(content: string, date?: string): Promise<void> {
    const dateStr = date ?? new Date().toISOString().slice(0, 10);
    const filePath = this._safeJoin(this.memoryDir, `${dateStr}.md`);
    await fs.appendFile(filePath, content, 'utf-8');
  }

  async readDailyMemory(date: string): Promise<string | null> {
    const filePath = this._safeJoin(this.memoryDir, `${date}.md`);
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
