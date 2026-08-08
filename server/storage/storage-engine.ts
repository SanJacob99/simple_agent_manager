import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { writeFileAtomic } from '../util/atomic-file';
import { Mutex } from '../util/mutex';
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
  /**
   * Serializes every read-modify-write of the session store. A single
   * StorageEngine instance is shared across all of an agent's concurrent
   * sessions/runs, so without this lock two interleaved create/update/delete
   * calls would each read the same snapshot and the later write would clobber
   * the earlier one (lost update).
   */
  private readonly storeLock = new Mutex();

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
      return this.storeCache;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        // No store file yet — an empty store is the correct initial state.
        this.storeCache = {};
        return this.storeCache;
      }
      // A transient I/O error (EACCES/EBUSY/EMFILE) or a corrupt/unparseable
      // file must NOT be silently treated as "empty": caching {} here would
      // cause the next createSession to persist an empty store over real data,
      // destroying every other session's metadata. Surface the error and leave
      // the cache unset so a subsequent call can retry once the cause clears.
      throw new Error(
        `Failed to read session store at ${this.storePath()}: ${(err as Error).message}`,
      );
    }
  }

  private async writeStore(store: Record<string, SessionStoreEntry>): Promise<void> {
    // Atomic write (temp file + rename) so a crash or disk-full mid-write can
    // never leave a truncated sessions.json that would fail to parse and wipe
    // the store. Cache is updated only after the write durably succeeds.
    await writeFileAtomic(this.storePath(), JSON.stringify(store, null, 2));
    this.storeCache = store;
  }

  async listSessions(): Promise<SessionStoreEntry[]> {
    const store = await this.readStore();
    // ⚡ Bolt Optimization: Use fast lexical string comparison instead of `new Date(...).getTime()` parsing overhead.
    // ISO 8601 strings naturally sort chronologically via direct string evaluation.
    return Object.values(store).sort((a, b) => {
      if (b.updatedAt > a.updatedAt) return 1;
      if (b.updatedAt < a.updatedAt) return -1;
      return 0;
    });
  }

  async createSession(entry: SessionStoreEntry): Promise<void> {
    await this.storeLock.run(async () => {
      const store = await this.readStore();
      await this.writeStore({
        ...store,
        [entry.sessionKey]: entry,
      });
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
    await this.storeLock.run(async () => {
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
    });
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const existing = await this.storeLock.run(async () => {
      const store = await this.readStore();
      const found = store[sessionKey];
      if (!found) {
        return null;
      }

      const { [sessionKey]: _deleted, ...rest } = store;
      await this.writeStore(rest);
      return found;
    });

    // Transcript file removal is independent of the store lock — keep the
    // critical section limited to the index mutation.
    if (existing) {
      await this.deleteTranscriptFile(existing);
    }
  }

  async deleteAllSessions(): Promise<void> {
    const store = await this.storeLock.run(async () => {
      const current = await this.readStore();
      await this.writeStore({});
      return current;
    });
    await Promise.all(
      Object.values(store).map((entry) => this.deleteTranscriptFile(entry)),
    );
  }

  async deleteAgentData(): Promise<void> {
    this.storeCache = null;
    await fs.rm(this.agentDir, { recursive: true, force: true });
  }

  resolveTranscriptPath(entry: Pick<SessionStoreEntry, 'sessionId' | 'sessionFile'>): string {
    if (!entry.sessionFile) {
      return this._safeJoin(this.sessionsDir, `${entry.sessionId}.jsonl`);
    }

    // 🛡️ Sentinel: [CRITICAL] Prevent absolute path bypass in resolveTranscriptPath
    // Even if path is absolute, it must be verified to be within the agentDir sandbox.
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

      // ⚡ Bolt Optimization: Use Promise.all to fetch file stats concurrently
      // instead of a sequential for...of loop. This eliminates N+1 I/O overhead.
      const stats = await Promise.all(
        files.map(async (file) => {
          try {
            const stat = await fs.stat(path.join(this.sessionsDir, file));
            return stat.isFile() ? stat.size : 0;
          } catch {
            // Ignore files that disappear between readdir and stat
            return 0;
          }
        })
      );

      return stats.reduce((acc, size) => acc + size, 0);
    } catch {
      return 0;
    }
  }

  async pruneStaleEntries(pruneAfterDays: number, dryRun: boolean): Promise<string[]> {
    const store = await this.readStore();
    // ⚡ Bolt Optimization: Compute a single ISO threshold string to compare directly against
    // `entry.updatedAt`. This avoids allocating parsed Date objects in a potentially large hot loop.
    const thresholdDateStr = new Date(Date.now() - pruneAfterDays * 24 * 60 * 60 * 1000).toISOString();
    const staleKeys: string[] = [];

    for (const [key, entry] of Object.entries(store)) {
      if (entry.updatedAt < thresholdDateStr) {
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

    // ⚡ Bolt Optimization: Process and unlink orphaned session files in chunks concurrently
    // to avoid sequential N+1 file deletion I/O operations while preventing EMFILE limits.
    const orphans: string[] = [];
    const CHUNK_SIZE = 50;

    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map(async (file) => {
          if (!file.endsWith('.jsonl')) return null;
          if (referenced.has(file)) return null;

          if (!dryRun) {
            try {
              await fs.unlink(path.join(this.sessionsDir, file));
            } catch {
              // Ignore
            }
          }
          return file;
        })
      );
      for (const res of results) {
        if (res !== null) orphans.push(res);
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

    // ⚡ Bolt Optimization: Fetch file stats and delete reset archives in chunks concurrently
    // to eliminate N+1 I/O overhead while preventing EMFILE limits.
    const CHUNK_SIZE = 50;

    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      const chunk = files.slice(i, i + CHUNK_SIZE);
      const results = await Promise.all(
        chunk.map(async (file) => {
          if (!file.includes('.reset.')) return null;

          const filePath = path.join(this.sessionsDir, file);
          try {
            const stat = await fs.stat(filePath);
            if (stat.isFile() && stat.mtimeMs < cutoff) {
              if (!dryRun) {
                await fs.unlink(filePath);
              }
              return filePath;
            }
          } catch {
            // Ignore
          }
          return null;
        })
      );
      for (const res of results) {
        if (res !== null) removed.push(res);
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
      await this.storeLock.run(async () => {
        const timestamp = Date.now();
        const bakPath = path.join(this.sessionsDir, `sessions.${timestamp}.json.bak`);
        await fs.rename(storeFilePath, bakPath);
        this.storeCache = null;
        await this.writeStore({});
      });
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
      // listSessions returns newest-first, so iterate backwards for oldest-first
      // ⚡ Bolt Optimization: iterating backwards avoids the memory allocation and copying
      // of [...sessions].reverse(), which can be costly on large datasets.

      for (let i = sessions.length - 1; i >= 0; i--) {
        if (currentUsage <= highWaterBytes) break;
        const session = sessions[i];
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
    // Self-heal the memory directory: init() only creates it when memory was
    // enabled at construction, but a later write must not throw ENOENT.
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.appendFile(filePath, content, 'utf-8');
  }

  /**
   * Overwrite a daily memory file with new content (atomic). Used by
   * compaction to actually replace/prune the file instead of appending to it.
   */
  async writeDailyMemory(content: string, date: string): Promise<void> {
    const filePath = this._safeJoin(this.memoryDir, `${date}.md`);
    await writeFileAtomic(filePath, content);
  }

  /** Remove a daily memory file. Missing files are a no-op. */
  async deleteDailyMemory(date: string): Promise<void> {
    const filePath = this._safeJoin(this.memoryDir, `${date}.md`);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        throw err;
      }
    }
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
    await writeFileAtomic(filePath, content);
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
