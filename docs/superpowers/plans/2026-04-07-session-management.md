# Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement session routing, session store schema (`sessions.json`), session lifecycle (daily/idle resets), and session status read path — replacing the current `_index.json` array with a `sessionKey -> SessionStoreEntry` map.

**Architecture:** A new `SessionRouter` class coordinates routing and resets at the gateway level, delegating persistence to `StorageEngine` (rewritten for `sessions.json`) and transcript I/O to pi-mono's `SessionManager`. The frontend evolves from session-id-keyed to session-key-keyed, backed by server queries.

**Tech Stack:** TypeScript, Vitest, Express, Zustand, `@mariozechner/pi-coding-agent` (SessionManager), `@xyflow/react`

**Spec:** `docs/superpowers/specs/2026-04-07-session-management-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `server/runtime/session-router.ts` | Gateway-level routing, reset checks, session lifecycle |
| `server/runtime/session-router.test.ts` | SessionRouter unit tests |

### Modified files
| File | Change |
|------|--------|
| `shared/storage-types.ts` | Replace `SessionMeta` with `SessionStoreEntry`, extract snapshot/report types |
| `shared/agent-config.ts:170-177` | Add reset fields to `ResolvedStorageConfig` |
| `src/types/nodes.ts:155-164` | Add reset fields to `StorageNodeData` |
| `src/utils/default-nodes.ts:88-97` | Add reset defaults |
| `src/utils/graph-to-agent.ts:130-141` | Pass reset fields through |
| `server/runtime/storage-engine.ts` | Rewrite: sessions.json map, drop JSONL methods |
| `server/runtime/storage-engine.test.ts` | Rewrite tests for new API |
| `server/index.ts` | Update/add session routes, remove JSONL routes |
| `src/runtime/storage-client.ts` | Rewrite to match new server API |
| `src/store/session-store.ts` | Rewrite: sessionKey-keyed, server-backed |
| `src/store/session-store.test.ts` | Rewrite tests |
| `src/panels/property-editors/StorageProperties.tsx` | Add Session Resets section |
| `server/agents/run-coordinator.ts` | Use SessionRouter for session resolution, SessionManager for transcripts |
| `server/agents/run-coordinator.test.ts` | Update tests for new session flow |
| `src/App.tsx:47-49` | Remove chat-store localStorage cleanup |
| `package.json` | Add `@mariozechner/pi-coding-agent` dependency |

### Removed files
| File | Reason |
|------|--------|
| `src/store/chat-store.ts` | Replaced by session-store |

---

### Task 1: Add pi-coding-agent dependency and update shared types

**Files:**
- Modify: `package.json`
- Modify: `shared/storage-types.ts`

- [ ] **Step 1: Install pi-coding-agent**

```bash
npm install @mariozechner/pi-coding-agent@^0.65.2
```

- [ ] **Step 2: Replace shared/storage-types.ts with new SessionStoreEntry schema**

Replace the entire contents of `shared/storage-types.ts`:

```typescript
// --- Session skills snapshot (extracted from old SessionMeta) ---

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

// --- Session system prompt report (extracted from old SessionMeta) ---

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

// --- Session store entry (replaces SessionMeta) ---

export interface SessionStoreEntry {
  // --- Identity ---
  sessionKey: string;
  sessionId: string;
  agentId: string;
  sessionFile?: string;

  // --- Timestamps ---
  createdAt: string;
  updatedAt: string;

  // --- Chat metadata ---
  chatType: 'direct' | 'group' | 'room';
  provider?: string;
  subject?: string;
  room?: string;
  space?: string;
  displayName?: string;

  // --- Toggles ---
  thinkingLevel?: string;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  sendPolicy?: string;

  // --- Model selection ---
  providerOverride?: string;
  modelOverride?: string;
  authProfileOverride?: string;

  // --- Token counters (best-effort, provider-dependent) ---
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalEstimatedCostUsd: number;

  // --- Skills snapshot ---
  skillsSnapshot?: SessionSkillsSnapshot;

  // --- System prompt report ---
  systemPromptReport?: SessionSystemPromptReport;

  // --- Compaction tracking ---
  compactionCount: number;
  memoryFlushAt?: string;
  memoryFlushCompactionCount?: number;
}

// --- Transcript entry (pi-mono compatible) ---

export interface SessionEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
}

// --- Memory file info ---

export interface MemoryFileInfo {
  name: string;
  isEvergreen: boolean;
  date: string | null;
}
```

- [ ] **Step 3: Verify the project still compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: type errors in files that still reference `SessionMeta` — this is expected and will be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add shared/storage-types.ts package.json package-lock.json
git commit -m "feat(sessions): add SessionStoreEntry schema and pi-coding-agent dependency"
```

---

### Task 2: Update storage node types, resolved config, and defaults

**Files:**
- Modify: `src/types/nodes.ts:155-164`
- Modify: `shared/agent-config.ts:170-177`
- Modify: `src/utils/default-nodes.ts:88-97`
- Modify: `src/utils/graph-to-agent.ts:130-141`

- [ ] **Step 1: Add reset fields to StorageNodeData**

In `src/types/nodes.ts`, replace the `StorageNodeData` interface (lines 155-164):

```typescript
export interface StorageNodeData {
  [key: string]: unknown;
  type: 'storage';
  label: string;
  backendType: StorageBackend;
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;
  dailyResetEnabled: boolean;
  dailyResetHour: number;
  idleResetEnabled: boolean;
  idleResetMinutes: number;
  parentForkMaxTokens: number;
}
```

- [ ] **Step 2: Add reset fields to ResolvedStorageConfig**

In `shared/agent-config.ts`, replace `ResolvedStorageConfig` (lines 170-177):

```typescript
export interface ResolvedStorageConfig {
  label: string;
  backendType: 'filesystem';
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;
  dailyResetEnabled: boolean;
  dailyResetHour: number;
  idleResetEnabled: boolean;
  idleResetMinutes: number;
  parentForkMaxTokens: number;
}
```

- [ ] **Step 3: Add reset defaults**

In `src/utils/default-nodes.ts`, replace the storage case (lines 88-97):

```typescript
    case 'storage':
      return {
        type: 'storage',
        label: 'Storage',
        backendType: 'filesystem',
        storagePath: '~/.simple-agent-manager/storage',
        sessionRetention: 50,
        memoryEnabled: true,
        dailyMemoryEnabled: true,
        dailyResetEnabled: true,
        dailyResetHour: 4,
        idleResetEnabled: false,
        idleResetMinutes: 60,
        parentForkMaxTokens: 100000,
      };
```

- [ ] **Step 4: Pass reset fields through in graph-to-agent.ts**

In `src/utils/graph-to-agent.ts`, replace the storage resolution block (lines 131-141):

```typescript
  const storageNode = connectedNodes.find((n) => n.data.type === 'storage');
  const storage = storageNode && storageNode.data.type === 'storage'
    ? {
        label: storageNode.data.label,
        backendType: storageNode.data.backendType,
        storagePath: storageNode.data.storagePath,
        sessionRetention: storageNode.data.sessionRetention,
        memoryEnabled: storageNode.data.memoryEnabled,
        dailyMemoryEnabled: storageNode.data.dailyMemoryEnabled,
        dailyResetEnabled: storageNode.data.dailyResetEnabled,
        dailyResetHour: storageNode.data.dailyResetHour,
        idleResetEnabled: storageNode.data.idleResetEnabled,
        idleResetMinutes: storageNode.data.idleResetMinutes,
        parentForkMaxTokens: storageNode.data.parentForkMaxTokens,
      }
    : null;
```

- [ ] **Step 5: Verify types compile**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: remaining errors only in files that still reference `SessionMeta` (storage-engine, run-coordinator, etc.).

- [ ] **Step 6: Commit**

```bash
git add src/types/nodes.ts shared/agent-config.ts src/utils/default-nodes.ts src/utils/graph-to-agent.ts
git commit -m "feat(sessions): add reset config to storage node types and defaults"
```

---

### Task 3: Rewrite StorageEngine for sessions.json

**Files:**
- Modify: `server/runtime/storage-engine.ts`
- Modify: `server/runtime/storage-engine.test.ts`

- [ ] **Step 1: Write failing tests for the new StorageEngine API**

Replace `server/runtime/storage-engine.test.ts` entirely:

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { StorageEngine } from './storage-engine';
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionStoreEntry } from '../../shared/storage-types';

function makeTempConfig(overrides?: Partial<ResolvedStorageConfig>): ResolvedStorageConfig {
  return {
    label: 'Test Storage',
    backendType: 'filesystem',
    storagePath: path.join(os.tmpdir(), `sam-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    sessionRetention: 50,
    memoryEnabled: true,
    dailyMemoryEnabled: true,
    dailyResetEnabled: true,
    dailyResetHour: 4,
    idleResetEnabled: false,
    idleResetMinutes: 60,
    parentForkMaxTokens: 100000,
    ...overrides,
  };
}

function makeEntry(overrides?: Partial<SessionStoreEntry>): SessionStoreEntry {
  const now = new Date().toISOString();
  return {
    sessionKey: 'agent:test-agent:main',
    sessionId: 'sess-1',
    agentId: 'test-agent',
    createdAt: now,
    updatedAt: now,
    chatType: 'direct',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalEstimatedCostUsd: 0,
    compactionCount: 0,
    ...overrides,
  };
}

describe('StorageEngine', () => {
  let config: ResolvedStorageConfig;
  let engine: StorageEngine;

  beforeEach(async () => {
    config = makeTempConfig();
    engine = new StorageEngine(config, 'test-agent');
    await engine.init();
  });

  afterEach(async () => {
    await fs.rm(config.storagePath, { recursive: true, force: true });
  });

  describe('directory structure', () => {
    it('creates agent sessions and memory directories on init', async () => {
      const sessionsDir = path.join(config.storagePath, 'test-agent', 'sessions');
      const memoryDir = path.join(config.storagePath, 'test-agent', 'memory');
      expect((await fs.stat(sessionsDir)).isDirectory()).toBe(true);
      expect((await fs.stat(memoryDir)).isDirectory()).toBe(true);
    });

    it('skips memory directory when memoryEnabled is false', async () => {
      const noMemConfig = makeTempConfig({ memoryEnabled: false });
      const noMemEngine = new StorageEngine(noMemConfig, 'test-agent');
      await noMemEngine.init();

      const sessionsDir = path.join(noMemConfig.storagePath, 'test-agent', 'sessions');
      const memoryDir = path.join(noMemConfig.storagePath, 'test-agent', 'memory');
      expect((await fs.stat(sessionsDir)).isDirectory()).toBe(true);
      await expect(fs.stat(memoryDir)).rejects.toThrow();

      await fs.rm(noMemConfig.storagePath, { recursive: true, force: true });
    });
  });

  describe('session CRUD (sessions.json)', () => {
    it('creates a session and lists it', async () => {
      const entry = makeEntry();
      await engine.createSession(entry);

      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionKey).toBe('agent:test-agent:main');
      expect(sessions[0].sessionId).toBe('sess-1');
    });

    it('stores sessions as a key-value map on disk', async () => {
      const entry = makeEntry();
      await engine.createSession(entry);

      const storePath = path.join(config.storagePath, 'test-agent', 'sessions', 'sessions.json');
      const raw = JSON.parse(await fs.readFile(storePath, 'utf-8'));
      expect(raw['agent:test-agent:main']).toBeDefined();
      expect(raw['agent:test-agent:main'].sessionId).toBe('sess-1');
    });

    it('gets a session by sessionKey', async () => {
      await engine.createSession(makeEntry());
      const found = await engine.getSession('agent:test-agent:main');
      expect(found).not.toBeNull();
      expect(found!.sessionId).toBe('sess-1');
    });

    it('returns null for non-existent sessionKey', async () => {
      const found = await engine.getSession('nonexistent');
      expect(found).toBeNull();
    });

    it('gets a session by sessionId (reverse lookup)', async () => {
      await engine.createSession(makeEntry());
      const found = await engine.getSessionById('sess-1');
      expect(found).not.toBeNull();
      expect(found!.sessionKey).toBe('agent:test-agent:main');
    });

    it('updates a session partially', async () => {
      await engine.createSession(makeEntry());
      await engine.updateSession('agent:test-agent:main', {
        inputTokens: 5000,
        outputTokens: 1200,
        updatedAt: '2026-04-07T12:00:00.000Z',
      });

      const updated = await engine.getSession('agent:test-agent:main');
      expect(updated!.inputTokens).toBe(5000);
      expect(updated!.outputTokens).toBe(1200);
    });

    it('deletes a session by sessionKey', async () => {
      await engine.createSession(makeEntry());
      await engine.deleteSession('agent:test-agent:main');
      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(0);
    });

    it('lists sessions sorted by updatedAt descending', async () => {
      await engine.createSession(makeEntry({
        sessionKey: 'agent:test-agent:old',
        sessionId: 'sess-old',
        updatedAt: '2026-04-01T10:00:00.000Z',
      }));
      await engine.createSession(makeEntry({
        sessionKey: 'agent:test-agent:new',
        sessionId: 'sess-new',
        updatedAt: '2026-04-07T10:00:00.000Z',
      }));

      const sessions = await engine.listSessions();
      expect(sessions[0].sessionKey).toBe('agent:test-agent:new');
      expect(sessions[1].sessionKey).toBe('agent:test-agent:old');
    });
  });

  describe('resolveTranscriptPath', () => {
    it('derives path from sessionId when sessionFile is not set', () => {
      const entry = makeEntry({ sessionId: 'abc-123' });
      const result = engine.resolveTranscriptPath(entry);
      expect(result).toContain(path.join('sessions', 'abc-123.jsonl'));
    });

    it('uses sessionFile when explicitly set', () => {
      const entry = makeEntry({ sessionFile: '/custom/path/transcript.jsonl' });
      const result = engine.resolveTranscriptPath(entry);
      expect(result).toBe('/custom/path/transcript.jsonl');
    });
  });

  describe('session retention', () => {
    it('prunes oldest sessions beyond retention limit', async () => {
      for (let i = 0; i < 5; i++) {
        await engine.createSession(makeEntry({
          sessionKey: `agent:test-agent:s${i}`,
          sessionId: `sess-${i}`,
          updatedAt: `2026-04-0${i + 1}T10:00:00.000Z`,
        }));
      }

      await engine.enforceRetention(3);
      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(3);
      const keys = sessions.map((s) => s.sessionKey);
      expect(keys).toContain('agent:test-agent:s4');
      expect(keys).toContain('agent:test-agent:s3');
      expect(keys).toContain('agent:test-agent:s2');
      expect(keys).not.toContain('agent:test-agent:s0');
    });
  });

  describe('memory files', () => {
    it('appends and reads daily memory', async () => {
      await engine.appendDailyMemory('First note\n', '2026-04-03');
      await engine.appendDailyMemory('Second note\n', '2026-04-03');
      const content = await engine.readDailyMemory('2026-04-03');
      expect(content).toContain('First note');
      expect(content).toContain('Second note');
    });

    it('writes and reads long-term memory', async () => {
      await engine.writeLongTermMemory('# Agent Memory\n\n- Important fact');
      const content = await engine.readLongTermMemory();
      expect(content).toBe('# Agent Memory\n\n- Important fact');
    });

    it('returns null for non-existent memory files', async () => {
      expect(await engine.readDailyMemory('2020-01-01')).toBeNull();
      expect(await engine.readLongTermMemory()).toBeNull();
    });

    it('lists memory files with metadata', async () => {
      await engine.writeLongTermMemory('# Memory');
      await engine.appendDailyMemory('Note', '2026-04-03');
      const files = await engine.listMemoryFiles();
      expect(files.length).toBeGreaterThanOrEqual(2);

      const longTerm = files.find((f) => f.name === 'MEMORY.md');
      expect(longTerm?.isEvergreen).toBe(true);

      const daily = files.find((f) => f.name === '2026-04-03.md');
      expect(daily?.isEvergreen).toBe(false);
      expect(daily?.date).toBe('2026-04-03');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run server/runtime/storage-engine.test.ts 2>&1 | tail -20
```

Expected: FAIL — methods like `createSession(entry)`, `getSession(key)`, etc. don't exist yet.

- [ ] **Step 3: Rewrite StorageEngine implementation**

Replace `server/runtime/storage-engine.ts` entirely:

```typescript
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

  // --- Store I/O (sessions.json) ---

  private storePath(): string {
    return path.join(this.sessionsDir, 'sessions.json');
  }

  private async readStore(): Promise<Record<string, SessionStoreEntry>> {
    if (this.storeCache) return this.storeCache;
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
    await fs.writeFile(this.storePath(), JSON.stringify(store, null, 2), 'utf-8');
  }

  // --- Session CRUD ---

  async createSession(entry: SessionStoreEntry): Promise<void> {
    const store = await this.readStore();
    store[entry.sessionKey] = entry;
    await this.writeStore(store);
  }

  async getSession(sessionKey: string): Promise<SessionStoreEntry | null> {
    const store = await this.readStore();
    return store[sessionKey] ?? null;
  }

  async getSessionById(sessionId: string): Promise<SessionStoreEntry | null> {
    const store = await this.readStore();
    for (const entry of Object.values(store)) {
      if (entry.sessionId === sessionId) return entry;
    }
    return null;
  }

  async updateSession(sessionKey: string, partial: Partial<SessionStoreEntry>): Promise<void> {
    const store = await this.readStore();
    if (!store[sessionKey]) return;
    store[sessionKey] = { ...store[sessionKey], ...partial };
    await this.writeStore(store);
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const store = await this.readStore();
    const entry = store[sessionKey];
    delete store[sessionKey];
    await this.writeStore(store);

    if (entry) {
      const transcriptPath = this.resolveTranscriptPath(entry);
      try {
        await fs.unlink(transcriptPath);
      } catch {
        // File may already be gone
      }
    }
  }

  async listSessions(): Promise<SessionStoreEntry[]> {
    const store = await this.readStore();
    return Object.values(store).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  // --- Transcript path helpers ---

  resolveTranscriptPath(entry: SessionStoreEntry): string {
    if (entry.sessionFile) {
      return path.isAbsolute(entry.sessionFile)
        ? entry.sessionFile
        : path.join(this.agentDir, entry.sessionFile);
    }
    return path.join(this.sessionsDir, `${entry.sessionId}.jsonl`);
  }

  getSessionsDir(): string {
    return this.sessionsDir;
  }

  // --- Retention ---

  async enforceRetention(maxSessions: number): Promise<void> {
    const sorted = await this.listSessions();
    if (sorted.length <= maxSessions) return;

    const toRemove = sorted.slice(maxSessions);
    for (const entry of toRemove) {
      await this.deleteSession(entry.sessionKey);
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run server/runtime/storage-engine.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/runtime/storage-engine.ts server/runtime/storage-engine.test.ts
git commit -m "feat(sessions): rewrite StorageEngine for sessions.json key-value map"
```

---

### Task 4: Implement SessionRouter

**Files:**
- Create: `server/runtime/session-router.ts`
- Create: `server/runtime/session-router.test.ts`

- [ ] **Step 1: Write failing tests for SessionRouter**

Create `server/runtime/session-router.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { SessionRouter } from './session-router';
import { StorageEngine } from './storage-engine';
import type { ResolvedStorageConfig } from '../../shared/agent-config';

function makeTempConfig(overrides?: Partial<ResolvedStorageConfig>): ResolvedStorageConfig {
  return {
    label: 'Test Storage',
    backendType: 'filesystem',
    storagePath: path.join(os.tmpdir(), `sam-router-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    sessionRetention: 50,
    memoryEnabled: false,
    dailyMemoryEnabled: false,
    dailyResetEnabled: true,
    dailyResetHour: 4,
    idleResetEnabled: false,
    idleResetMinutes: 60,
    parentForkMaxTokens: 100000,
    ...overrides,
  };
}

describe('SessionRouter', () => {
  let config: ResolvedStorageConfig;
  let engine: StorageEngine;
  let router: SessionRouter;

  beforeEach(async () => {
    config = makeTempConfig();
    engine = new StorageEngine(config, 'test-agent');
    await engine.init();
    router = new SessionRouter(engine, config, 'agent-node-123');
  });

  afterEach(async () => {
    await fs.rm(config.storagePath, { recursive: true, force: true });
  });

  describe('route()', () => {
    it('creates a new session when none exists for the key', async () => {
      const result = await router.route({ agentId: 'agent-node-123' });

      expect(result.sessionKey).toBe('agent:agent-node-123:main');
      expect(result.sessionId).toBeDefined();
      expect(result.transcriptPath).toContain('.jsonl');
      expect(result.created).toBe(true);
      expect(result.reset).toBe(false);
    });

    it('returns existing session on subsequent routes', async () => {
      const first = await router.route({ agentId: 'agent-node-123' });
      const second = await router.route({ agentId: 'agent-node-123' });

      expect(second.sessionKey).toBe(first.sessionKey);
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.created).toBe(false);
      expect(second.reset).toBe(false);
    });

    it('uses subKey in sessionKey when provided', async () => {
      const result = await router.route({ agentId: 'agent-node-123', subKey: 'debug' });
      expect(result.sessionKey).toBe('agent:agent-node-123:debug');
    });

    it('creates transcript file on disk', async () => {
      const result = await router.route({ agentId: 'agent-node-123' });
      const stat = await fs.stat(result.transcriptPath);
      expect(stat.isFile()).toBe(true);
    });
  });

  describe('daily reset', () => {
    it('resets session when updatedAt is before daily reset hour', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const first = await router.route({ agentId: 'agent-node-123' });
      await engine.updateSession(first.sessionKey, {
        updatedAt: yesterday.toISOString(),
      });

      const second = await router.route({ agentId: 'agent-node-123' });

      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.reset).toBe(true);
      expect(second.created).toBe(false);
    });

    it('does not reset when daily reset is disabled', async () => {
      const noResetConfig = makeTempConfig({ dailyResetEnabled: false });
      const noResetEngine = new StorageEngine(noResetConfig, 'test-agent');
      await noResetEngine.init();
      const noResetRouter = new SessionRouter(noResetEngine, noResetConfig, 'agent-node-123');

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const first = await noResetRouter.route({ agentId: 'agent-node-123' });
      await noResetEngine.updateSession(first.sessionKey, {
        updatedAt: yesterday.toISOString(),
      });

      const second = await noResetRouter.route({ agentId: 'agent-node-123' });
      expect(second.sessionId).toBe(first.sessionId);
      expect(second.reset).toBe(false);

      await fs.rm(noResetConfig.storagePath, { recursive: true, force: true });
    });
  });

  describe('idle reset', () => {
    it('resets session when idle time exceeds threshold', async () => {
      const idleConfig = makeTempConfig({
        dailyResetEnabled: false,
        idleResetEnabled: true,
        idleResetMinutes: 1,
      });
      const idleEngine = new StorageEngine(idleConfig, 'test-agent');
      await idleEngine.init();
      const idleRouter = new SessionRouter(idleEngine, idleConfig, 'agent-node-123');

      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);

      const first = await idleRouter.route({ agentId: 'agent-node-123' });
      await idleEngine.updateSession(first.sessionKey, {
        updatedAt: twoMinutesAgo.toISOString(),
      });

      const second = await idleRouter.route({ agentId: 'agent-node-123' });
      expect(second.sessionId).not.toBe(first.sessionId);
      expect(second.reset).toBe(true);

      await fs.rm(idleConfig.storagePath, { recursive: true, force: true });
    });
  });

  describe('resetSession()', () => {
    it('forces a reset and returns new sessionId', async () => {
      const first = await router.route({ agentId: 'agent-node-123' });
      const resetResult = await router.resetSession(first.sessionKey);

      expect(resetResult.sessionId).not.toBe(first.sessionId);
      expect(resetResult.sessionKey).toBe(first.sessionKey);
      expect(resetResult.reset).toBe(true);
    });
  });

  describe('getStatus()', () => {
    it('returns session entry for existing key', async () => {
      const routed = await router.route({ agentId: 'agent-node-123' });
      const status = await router.getStatus(routed.sessionKey);
      expect(status).not.toBeNull();
      expect(status!.sessionId).toBe(routed.sessionId);
    });

    it('returns null for non-existent key', async () => {
      const status = await router.getStatus('nonexistent');
      expect(status).toBeNull();
    });
  });

  describe('listSessions()', () => {
    it('returns all sessions for the agent', async () => {
      await router.route({ agentId: 'agent-node-123', subKey: 'main' });
      await router.route({ agentId: 'agent-node-123', subKey: 'debug' });

      const sessions = await router.listSessions();
      expect(sessions).toHaveLength(2);
    });
  });

  describe('updateAfterTurn()', () => {
    it('updates token counters on the session entry', async () => {
      const routed = await router.route({ agentId: 'agent-node-123' });
      await router.updateAfterTurn(routed.sessionKey, {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
      });

      const status = await router.getStatus(routed.sessionKey);
      expect(status!.inputTokens).toBe(1000);
      expect(status!.outputTokens).toBe(500);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run server/runtime/session-router.test.ts 2>&1 | tail -20
```

Expected: FAIL — `SessionRouter` module doesn't exist yet.

- [ ] **Step 3: Implement SessionRouter**

Create `server/runtime/session-router.ts`:

```typescript
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionStoreEntry } from '../../shared/storage-types';
import type { StorageEngine } from './storage-engine';

export interface RouteRequest {
  agentId: string;
  chatType?: 'direct' | 'group' | 'room';
  subKey?: string;
  provider?: string;
  room?: string;
  space?: string;
}

export interface RouteResult {
  sessionKey: string;
  sessionId: string;
  transcriptPath: string;
  created: boolean;
  reset: boolean;
}

export class SessionRouter {
  constructor(
    private readonly storageEngine: StorageEngine,
    private readonly storageConfig: ResolvedStorageConfig,
    private readonly agentId: string,
  ) {}

  async route(req: RouteRequest): Promise<RouteResult> {
    const sessionKey = `agent:${req.agentId}:${req.subKey ?? 'main'}`;
    const existing = await this.storageEngine.getSession(sessionKey);

    if (!existing) {
      return this.createNewSession(sessionKey, req);
    }

    // Check resets (whichever expires first wins)
    if (this.shouldReset(existing)) {
      return this.performReset(existing);
    }

    // Touch updatedAt
    await this.storageEngine.updateSession(sessionKey, {
      updatedAt: new Date().toISOString(),
    });

    return {
      sessionKey,
      sessionId: existing.sessionId,
      transcriptPath: this.storageEngine.resolveTranscriptPath(existing),
      created: false,
      reset: false,
    };
  }

  async resetSession(sessionKey: string): Promise<RouteResult> {
    const existing = await this.storageEngine.getSession(sessionKey);
    if (!existing) {
      throw new Error(`Session not found: ${sessionKey}`);
    }
    return this.performReset(existing);
  }

  async getStatus(sessionKey: string): Promise<SessionStoreEntry | null> {
    return this.storageEngine.getSession(sessionKey);
  }

  async listSessions(): Promise<SessionStoreEntry[]> {
    return this.storageEngine.listSessions();
  }

  async updateAfterTurn(sessionKey: string, updates: Partial<SessionStoreEntry>): Promise<void> {
    await this.storageEngine.updateSession(sessionKey, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  }

  // --- Private helpers ---

  private shouldReset(entry: SessionStoreEntry): boolean {
    const now = new Date();
    const updatedAt = new Date(entry.updatedAt);

    // Daily reset check
    if (this.storageConfig.dailyResetEnabled) {
      const resetBoundary = new Date(now);
      resetBoundary.setHours(this.storageConfig.dailyResetHour, 0, 0, 0);

      // If we haven't passed today's boundary yet, use yesterday's
      if (now < resetBoundary) {
        resetBoundary.setDate(resetBoundary.getDate() - 1);
      }

      if (updatedAt < resetBoundary) {
        return true;
      }
    }

    // Idle reset check
    if (this.storageConfig.idleResetEnabled) {
      const idleMs = this.storageConfig.idleResetMinutes * 60 * 1000;
      if (now.getTime() - updatedAt.getTime() > idleMs) {
        return true;
      }
    }

    return false;
  }

  private async createNewSession(sessionKey: string, req: RouteRequest): Promise<RouteResult> {
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    const entry: SessionStoreEntry = {
      sessionKey,
      sessionId,
      agentId: req.agentId,
      createdAt: now,
      updatedAt: now,
      chatType: req.chatType ?? 'direct',
      provider: req.provider,
      room: req.room,
      space: req.space,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      compactionCount: 0,
    };

    await this.storageEngine.createSession(entry);
    const transcriptPath = await this.createTranscriptFile(sessionId);

    return { sessionKey, sessionId, transcriptPath, created: true, reset: false };
  }

  private async performReset(existing: SessionStoreEntry): Promise<RouteResult> {
    const newSessionId = randomUUID();
    const now = new Date().toISOString();

    await this.storageEngine.updateSession(existing.sessionKey, {
      sessionId: newSessionId,
      createdAt: now,
      updatedAt: now,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      compactionCount: 0,
      sessionFile: undefined,
    });

    const transcriptPath = await this.createTranscriptFile(
      newSessionId,
      this.storageEngine.resolveTranscriptPath(existing),
    );

    return {
      sessionKey: existing.sessionKey,
      sessionId: newSessionId,
      transcriptPath,
      created: false,
      reset: true,
    };
  }

  private async createTranscriptFile(sessionId: string, parentSession?: string): Promise<string> {
    const transcriptPath = path.join(this.storageEngine.getSessionsDir(), `${sessionId}.jsonl`);
    const header = JSON.stringify({
      type: 'session',
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      ...(parentSession ? { parentSession } : {}),
    });
    await fs.writeFile(transcriptPath, header + '\n', 'utf-8');
    return transcriptPath;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run server/runtime/session-router.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/runtime/session-router.ts server/runtime/session-router.test.ts
git commit -m "feat(sessions): implement SessionRouter with routing, resets, and lifecycle"
```

---

### Task 5: Update server routes

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Update server/index.ts**

Replace the storage routes section in `server/index.ts`. The key changes:
- Import `SessionStoreEntry` instead of `SessionMeta`
- Import `SessionRouter`
- Replace `_index.json`-based routes with `sessions.json`-based routes
- Remove JSONL entry routes (appendEntry, readEntries, replaceEntries) — these are now handled by SessionManager
- Remove `createManagedSession` route
- Add session route/reset/status endpoints

```typescript
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { StorageEngine } from './runtime/storage-engine';
import { SessionRouter } from './runtime/session-router';
import { AgentManager } from './agents/agent-manager';
import { ApiKeyStore } from './auth/api-keys';
import { handleConnection } from './connections/ws-handler';
import { getGlobalHookRegistry } from './agents/agent-manager';
import { HOOK_NAMES, type BackendLifecycleContext } from './hooks/hook-types';
import { createStartupErrorHandler } from './startup';
import type { ResolvedStorageConfig } from '../shared/agent-config';
import type { SessionStoreEntry } from '../shared/storage-types';

const app = express();
app.use(express.json({ limit: '10mb' }));

// --- Shared state ---

const apiKeys = new ApiKeyStore();
const agentManager = new AgentManager(apiKeys);

// --- Storage engine and router instances ---

const engines = new Map<string, StorageEngine>();
const routers = new Map<string, SessionRouter>();

function getOrCreateEngine(config: ResolvedStorageConfig, agentName: string): StorageEngine {
  const key = `${config.storagePath}:${agentName}`;
  let engine = engines.get(key);
  if (!engine) {
    engine = new StorageEngine(config, agentName);
    engines.set(key, engine);
  }
  return engine;
}

function getOrCreateRouter(config: ResolvedStorageConfig, agentName: string, agentId: string): SessionRouter {
  const key = `${config.storagePath}:${agentName}:${agentId}`;
  let router = routers.get(key);
  if (!router) {
    const engine = getOrCreateEngine(config, agentName);
    router = new SessionRouter(engine, config, agentId);
    routers.set(key, router);
  }
  return router;
}

// --- Storage init ---

app.post('/api/storage/init', async (req, res) => {
  const { config, agentName } = req.body as { config: ResolvedStorageConfig; agentName: string };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.init();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Session routes ---

app.get('/api/sessions/:agentId', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateRouter(parsedConfig, agentName, req.params.agentId);
    const sessions = await router.listSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/sessions/:agentId/:sessionKey', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateRouter(parsedConfig, agentName, req.params.agentId);
    const status = await router.getStatus(decodeURIComponent(req.params.sessionKey));
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/sessions/:agentId/route', async (req, res) => {
  const { config, agentName, routeRequest } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    routeRequest: { agentId: string; chatType?: string; subKey?: string; provider?: string; room?: string; space?: string };
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.init();
    const router = getOrCreateRouter(config, agentName, req.params.agentId);
    const result = await router.route(routeRequest as any);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/sessions/:agentId/reset', async (req, res) => {
  const { config, agentName, sessionKey } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    sessionKey: string;
  };
  try {
    const router = getOrCreateRouter(config, agentName, req.params.agentId);
    const result = await router.resetSession(sessionKey);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.delete('/api/sessions/:agentId/:sessionKey', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    await engine.deleteSession(decodeURIComponent(req.params.sessionKey));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/sessions/enforce-retention', async (req, res) => {
  const { config, agentName, maxSessions } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    maxSessions: number;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.enforceRetention(maxSessions);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Memory routes (unchanged) ---

app.post('/api/storage/memory/daily', async (req, res) => {
  const { config, agentName, content, date } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    content: string;
    date?: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.appendDailyMemory(content, date);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/memory/daily/:date', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const content = await engine.readDailyMemory(req.params.date);
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/memory/long-term', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const content = await engine.readLongTermMemory();
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.put('/api/storage/memory/long-term', async (req, res) => {
  const { config, agentName, content } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
    content: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    await engine.writeLongTermMemory(content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/storage/memory/files', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const files = await engine.listMemoryFiles();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Health check ---

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// --- Start server with WebSocket support ---

const PORT = parseInt(process.env.STORAGE_PORT ?? '3210', 10);
const httpServer = createServer(app);

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
const handleStartupError = createStartupErrorHandler({ port: PORT });

httpServer.once('error', handleStartupError);
wss.once('error', handleStartupError);

wss.on('connection', (socket) => {
  handleConnection(socket, agentManager, apiKeys);
});

httpServer.listen(PORT, () => {
  httpServer.off('error', handleStartupError);
  wss.off('error', handleStartupError);
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}/ws`);

  const globalRegistry = getGlobalHookRegistry();
  const startCtx: BackendLifecycleContext = { phase: 'start', timestamp: Date.now() };
  globalRegistry.invoke(HOOK_NAMES.BACKEND_START, startCtx).catch((err) => {
    console.error('[Server] backend_start hook error:', err);
  });
});

// --- Graceful shutdown ---

async function shutdown() {
  console.log('\nShutting down...');

  try {
    const globalRegistry = getGlobalHookRegistry();
    const stopCtx: BackendLifecycleContext = { phase: 'stop', timestamp: Date.now() };
    await globalRegistry.invoke(HOOK_NAMES.BACKEND_STOP, stopCtx);
  } catch (err) {
    console.error('[Server] backend_stop hook error:', err);
  }

  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down');
  }

  agentManager.shutdown()
    .then(() => {
      httpServer.close(() => {
        console.log('Server closed.');
        process.exit(0);
      });
    })
    .catch((err) => {
      console.error('Error during shutdown:', err);
      process.exit(1);
    });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: should compile (may have errors in files not yet updated — RunCoordinator, StorageClient, session-store).

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat(sessions): update server routes for session routing and status API"
```

---

### Task 6: Rewrite StorageClient for new API

**Files:**
- Modify: `src/runtime/storage-client.ts`

- [ ] **Step 1: Rewrite StorageClient**

Replace `src/runtime/storage-client.ts`:

```typescript
import type { ResolvedStorageConfig } from '../../shared/agent-config';
import type { SessionStoreEntry, MemoryFileInfo } from '../../shared/storage-types';
import type { RouteResult, RouteRequest } from '../../server/runtime/session-router';

/**
 * Browser-side client that delegates to the server via fetch.
 * Updated for session-key-based routing.
 */
export class StorageClient {
  constructor(
    private readonly config: ResolvedStorageConfig,
    private readonly agentName: string,
    private readonly agentId: string,
  ) {}

  private configParam(): string {
    return encodeURIComponent(JSON.stringify(this.config));
  }

  private queryStr(): string {
    return `config=${this.configParam()}&agentName=${encodeURIComponent(this.agentName)}`;
  }

  // --- Init ---

  async init(): Promise<void> {
    const res = await fetch('/api/storage/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  // --- Session routing ---

  async route(routeRequest: RouteRequest): Promise<RouteResult> {
    const res = await fetch(`/api/sessions/${encodeURIComponent(this.agentId)}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: this.config,
        agentName: this.agentName,
        routeRequest,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async resetSession(sessionKey: string): Promise<RouteResult> {
    const res = await fetch(`/api/sessions/${encodeURIComponent(this.agentId)}/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: this.config,
        agentName: this.agentName,
        sessionKey,
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // --- Session queries ---

  async listSessions(): Promise<SessionStoreEntry[]> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}?${this.queryStr()}`,
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async getSessionStatus(sessionKey: string): Promise<SessionStoreEntry | null> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}?${this.queryStr()}`,
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async deleteSession(sessionKey: string): Promise<void> {
    const res = await fetch(
      `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}?${this.queryStr()}`,
      { method: 'DELETE' },
    );
    if (!res.ok) throw new Error(await res.text());
  }

  async enforceRetention(maxSessions: number): Promise<void> {
    const res = await fetch('/api/storage/sessions/enforce-retention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, maxSessions }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  // --- Memory (unchanged) ---

  async appendDailyMemory(content: string, date?: string): Promise<void> {
    const res = await fetch('/api/storage/memory/daily', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, content, date }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async readDailyMemory(date: string): Promise<string | null> {
    const res = await fetch(`/api/storage/memory/daily/${date}?${this.queryStr()}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.content;
  }

  async readLongTermMemory(): Promise<string | null> {
    const res = await fetch(`/api/storage/memory/long-term?${this.queryStr()}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.content;
  }

  async writeLongTermMemory(content: string): Promise<void> {
    const res = await fetch('/api/storage/memory/long-term', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: this.config, agentName: this.agentName, content }),
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async listMemoryFiles(): Promise<MemoryFileInfo[]> {
    const res = await fetch(`/api/storage/memory/files?${this.queryStr()}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/runtime/storage-client.ts
git commit -m "feat(sessions): rewrite StorageClient for session-key-based API"
```

---

### Task 7: Rewrite session-store (frontend Zustand)

**Files:**
- Modify: `src/store/session-store.ts`
- Modify: `src/store/session-store.test.ts`

- [ ] **Step 1: Write failing tests for new session store**

Replace `src/store/session-store.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from './session-store';

function mockStorageClient() {
  return {
    route: vi.fn(async (req: any) => ({
      sessionKey: `agent:${req.agentId}:${req.subKey ?? 'main'}`,
      sessionId: 'backend-session-id',
      transcriptPath: '/path/to/transcript.jsonl',
      created: true,
      reset: false,
    })),
    resetSession: vi.fn(async () => ({
      sessionKey: 'agent:test:main',
      sessionId: 'new-session-id',
      transcriptPath: '/path/to/new.jsonl',
      created: false,
      reset: true,
    })),
    listSessions: vi.fn(async () => [
      {
        sessionKey: 'agent:test:main',
        sessionId: 'backend-session-id',
        agentId: 'test',
        createdAt: '2026-04-07T10:00:00.000Z',
        updatedAt: '2026-04-07T10:00:00.000Z',
        chatType: 'direct',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        compactionCount: 0,
      },
    ]),
    getSessionStatus: vi.fn(async () => null),
    deleteSession: vi.fn(async () => {}),
    enforceRetention: vi.fn(async () => {}),
  } as any;
}

describe('session-store', () => {
  beforeEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
  });

  afterEach(() => {
    useSessionStore.getState().unbindStorage();
    useSessionStore.getState().resetAllSessions();
    vi.restoreAllMocks();
  });

  it('routes a session via the server and stores the entry', async () => {
    const client = mockStorageClient();
    const store = useSessionStore.getState();
    store.bindStorage(client);

    const sessionKey = await store.routeSession('test');
    expect(sessionKey).toBe('agent:test:main');
    expect(client.route).toHaveBeenCalledWith({ agentId: 'test' });

    const sessions = useSessionStore.getState().sessions;
    expect(sessions['agent:test:main']).toBeDefined();
    expect(sessions['agent:test:main'].sessionId).toBe('backend-session-id');
  });

  it('fetches sessions from the server', async () => {
    const client = mockStorageClient();
    const store = useSessionStore.getState();
    store.bindStorage(client);

    await store.fetchSessions();
    const sessions = useSessionStore.getState().sessions;
    expect(sessions['agent:test:main']).toBeDefined();
    expect(client.listSessions).toHaveBeenCalled();
  });

  it('maps activeSessionKey by nodeId', () => {
    const store = useSessionStore.getState();
    store.setActiveSession('node-1', 'agent:test:main');
    expect(store.getActiveSessionKey('node-1')).toBe('agent:test:main');
  });

  it('deletes a session via the server', async () => {
    const client = mockStorageClient();
    const store = useSessionStore.getState();
    store.bindStorage(client);

    await store.routeSession('test');
    await store.deleteSession('agent:test:main');

    expect(client.deleteSession).toHaveBeenCalledWith('agent:test:main');
    expect(useSessionStore.getState().sessions['agent:test:main']).toBeUndefined();
  });

  it('resets all sessions clears state', () => {
    const store = useSessionStore.getState();
    store.setActiveSession('node-1', 'agent:test:main');
    store.resetAllSessions();

    expect(useSessionStore.getState().sessions).toEqual({});
    expect(useSessionStore.getState().activeSessionKey).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/store/session-store.test.ts 2>&1 | tail -20
```

Expected: FAIL — `routeSession`, `fetchSessions`, `activeSessionKey`, etc. don't exist yet.

- [ ] **Step 3: Rewrite session-store.ts**

Replace `src/store/session-store.ts`:

```typescript
import { create } from 'zustand';
import type { SessionStoreEntry } from '../../shared/storage-types';
import type { StorageClient } from '../runtime/storage-client';

// ── Message types (kept for UI compatibility) ─────────────────────────────

export interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  tokenCount?: number;
  usage?: MessageUsage;
}

// ── Store ──────────────────────────────────────────────────────────────────

interface SessionStore {
  /** Sessions keyed by sessionKey */
  sessions: Record<string, SessionStoreEntry>;
  /** Maps nodeId -> active sessionKey */
  activeSessionKey: Record<string, string>;
  /** Bound storage client (null until connected) */
  storageClient: StorageClient | null;

  // Storage binding
  bindStorage: (client: StorageClient) => void;
  unbindStorage: () => void;

  // Session lifecycle (server-backed)
  routeSession: (agentId: string, subKey?: string) => Promise<string>;
  resetSession: (sessionKey: string) => Promise<string>;
  deleteSession: (sessionKey: string) => Promise<void>;
  fetchSessions: () => Promise<void>;

  // Active session mapping
  setActiveSession: (nodeId: string, sessionKey: string) => void;
  getActiveSessionKey: (nodeId: string) => string | null;
  clearActiveSession: (nodeId: string) => void;

  // Maintenance
  resetAllSessions: () => void;
}

export const useSessionStore = create<SessionStore>()(
  (set, get) => ({
    sessions: {},
    activeSessionKey: {},
    storageClient: null,

    bindStorage: (client) => {
      set({ storageClient: client });
    },

    unbindStorage: () => {
      set({ storageClient: null, sessions: {}, activeSessionKey: {} });
    },

    routeSession: async (agentId, subKey) => {
      const { storageClient } = get();
      if (!storageClient) {
        throw new Error('Cannot route session without a bound storage client');
      }

      const result = await storageClient.route({ agentId, subKey });
      const status = await storageClient.getSessionStatus(result.sessionKey);

      if (status) {
        set((state) => ({
          sessions: { ...state.sessions, [result.sessionKey]: status },
        }));
      }

      return result.sessionKey;
    },

    resetSession: async (sessionKey) => {
      const { storageClient } = get();
      if (!storageClient) {
        throw new Error('Cannot reset session without a bound storage client');
      }

      const result = await storageClient.resetSession(sessionKey);
      const status = await storageClient.getSessionStatus(result.sessionKey);

      if (status) {
        set((state) => ({
          sessions: { ...state.sessions, [result.sessionKey]: status },
        }));
      }

      return result.sessionKey;
    },

    deleteSession: async (sessionKey) => {
      const { storageClient } = get();
      if (storageClient) {
        await storageClient.deleteSession(sessionKey);
      }

      set((state) => {
        const { [sessionKey]: _, ...rest } = state.sessions;
        const nextActive = { ...state.activeSessionKey };
        for (const [nodeId, activeKey] of Object.entries(nextActive)) {
          if (activeKey === sessionKey) delete nextActive[nodeId];
        }
        return { sessions: rest, activeSessionKey: nextActive };
      });
    },

    fetchSessions: async () => {
      const { storageClient } = get();
      if (!storageClient) return;

      const entries = await storageClient.listSessions();
      const sessions: Record<string, SessionStoreEntry> = {};
      for (const entry of entries) {
        sessions[entry.sessionKey] = entry;
      }

      set({ sessions });
    },

    setActiveSession: (nodeId, sessionKey) => {
      set((state) => ({
        activeSessionKey: { ...state.activeSessionKey, [nodeId]: sessionKey },
      }));
    },

    getActiveSessionKey: (nodeId) => get().activeSessionKey[nodeId] ?? null,

    clearActiveSession: (nodeId) => {
      set((state) => {
        const { [nodeId]: _, ...rest } = state.activeSessionKey;
        return { activeSessionKey: rest };
      });
    },

    resetAllSessions: () => {
      set({ sessions: {}, activeSessionKey: {} });
    },
  }),
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/store/session-store.test.ts 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/session-store.ts src/store/session-store.test.ts
git commit -m "feat(sessions): rewrite session-store for sessionKey-based routing"
```

---

### Task 8: Update StorageProperties editor

**Files:**
- Modify: `src/panels/property-editors/StorageProperties.tsx`

- [ ] **Step 1: Add Session Resets section to StorageProperties**

In `src/panels/property-editors/StorageProperties.tsx`, add the new fields after the existing Daily Memory section (after line 82, before the closing `</div>`):

```tsx
      <div className="border-t border-slate-700 mt-2 pt-2">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Session Resets</p>

        <Field label="Daily Reset">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={data.dailyResetEnabled}
              onChange={(e) => update(nodeId, { dailyResetEnabled: e.target.checked })}
            />
            Reset sessions daily
          </label>
        </Field>

        {data.dailyResetEnabled && (
          <Field label="Reset Hour">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={23}
              value={data.dailyResetHour}
              onChange={(e) =>
                update(nodeId, { dailyResetHour: parseInt(e.target.value, 10) || 4 })
              }
            />
          </Field>
        )}

        <Field label="Idle Reset">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={data.idleResetEnabled}
              onChange={(e) => update(nodeId, { idleResetEnabled: e.target.checked })}
            />
            Reset after inactivity
          </label>
        </Field>

        {data.idleResetEnabled && (
          <Field label="Idle Minutes">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={data.idleResetMinutes}
              onChange={(e) =>
                update(nodeId, { idleResetMinutes: parseInt(e.target.value, 10) || 60 })
              }
            />
          </Field>
        )}

        <Field label="Fork Max Tokens">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={data.parentForkMaxTokens}
            onChange={(e) =>
              update(nodeId, { parentForkMaxTokens: parseInt(e.target.value, 10) || 100000 })
            }
          />
        </Field>
      </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/panels/property-editors/StorageProperties.tsx
git commit -m "feat(sessions): add session reset config to StorageProperties editor"
```

---

### Task 9: Update RunCoordinator for SessionRouter integration

**Files:**
- Modify: `server/agents/run-coordinator.ts`

- [ ] **Step 1: Update RunCoordinator imports and constructor**

In `server/agents/run-coordinator.ts`:

1. Replace the `SessionMeta` import with `SessionStoreEntry`:
   - Change `import type { SessionMeta } from '../../shared/storage-types';` to `import type { SessionStoreEntry } from '../../shared/storage-types';`

2. Replace `StorageEngine` import with `SessionRouter`:
   - Change `import type { StorageEngine } from '../runtime/storage-engine';` to `import type { SessionRouter } from '../runtime/session-router';`

3. Update the constructor parameter:
   - Change `private readonly storage: StorageEngine | null,` to `private readonly sessionRouter: SessionRouter | null,`

- [ ] **Step 2: Add SessionManager import and instance tracking**

Add at the top of the file:

```typescript
import { SessionManager } from '@mariozechner/pi-coding-agent';
```

Add a field to the class:

```typescript
  private sessionManagers = new Map<string, SessionManager>();
```

Add a helper method to the class (private section):

```typescript
  private getOrOpenSessionManager(sessionId: string, transcriptPath: string): SessionManager {
    let sm = this.sessionManagers.get(sessionId);
    if (!sm) {
      sm = SessionManager.open(transcriptPath);
      this.sessionManagers.set(sessionId, sm);
    }
    return sm;
  }
```

- [ ] **Step 3: Update resolveSession() to use SessionRouter and open SessionManager**

Replace the `resolveSession` method (lines 304-338):

```typescript
  private async resolveSession(sessionKey: string): Promise<string> {
    if (!this.sessionRouter) {
      throw new Error('Cannot resolve session: no session router configured');
    }

    const result = await this.sessionRouter.route({
      agentId: this.agentId,
      subKey: sessionKey === this.agentId ? 'main' : sessionKey,
    });

    // Pre-open SessionManager for transcript writes
    this.getOrOpenSessionManager(result.sessionId, result.transcriptPath);

    if (result.created && this.hooks) {
      const sessionCtx: SessionLifecycleContext = {
        agentId: this.agentId,
        sessionId: result.sessionId,
        sessionKey: result.sessionKey,
        phase: 'start',
      };
      await this.hooks.invoke(HOOK_NAMES.SESSION_START, sessionCtx);
    }

    return result.sessionId;
  }
```

- [ ] **Step 4: Update appendTranscriptMessage to write via SessionManager**

Replace the `appendTranscriptMessage` method (lines 635-680):

```typescript
  private async appendTranscriptMessage(
    sessionId: string,
    message: {
      role: 'user' | 'assistant' | 'tool';
      content: string;
      timestamp: number;
      tokenCount?: number;
      usage?: RunUsage;
    },
  ): Promise<void> {
    if (!this.sessionRouter) {
      return;
    }

    // Write to transcript via SessionManager
    const sm = this.sessionManagers.get(sessionId);
    if (sm) {
      sm.appendMessage({
        role: message.role as 'user' | 'assistant',
        content: [{ type: 'text', text: message.content }],
        timestamp: message.timestamp,
      });
    }

    // Update session metadata counters
    const sessions = await this.sessionRouter.listSessions();
    const session = sessions.find((s) => s.sessionId === sessionId);
    if (!session) {
      return;
    }

    const updates: Partial<import('../../shared/storage-types').SessionStoreEntry> = {};
    if (message.usage) {
      updates.inputTokens = session.inputTokens + message.usage.input;
      updates.outputTokens = session.outputTokens + message.usage.output;
      updates.totalTokens = session.totalTokens + message.usage.totalTokens;
      updates.cacheRead = session.cacheRead + message.usage.cacheRead;
      updates.cacheWrite = session.cacheWrite + message.usage.cacheWrite;
    }

    await this.sessionRouter.updateAfterTurn(session.sessionKey, updates);
  }
```

- [ ] **Step 4: Update dispatch() guard**

In the `dispatch()` method, change `if (!this.storage)` to `if (!this.sessionRouter)` (line 90-92):

```typescript
    if (!this.sessionRouter) {
      throw new Error('Cannot dispatch: no session router configured for this agent');
    }
```

- [ ] **Step 5: Clean up SessionManager instances in destroy()**

In the `destroy()` method, add cleanup for SessionManager instances:

```typescript
    this.sessionManagers.clear();
```

Add this after `this.pendingParams.clear();` in the destroy method.

- [ ] **Step 7: Update persistUserMessage and persistRuntimeEvent**

Change `if (!this.storage)` guards to `if (!this.sessionRouter)` in `persistUserMessage` (line 536).

In `persistRuntimeEvent`, the method calls `appendTranscriptMessage` which we already updated. No additional changes needed.

- [ ] **Step 8: Verify tests compile and pass**

```bash
npx vitest run server/agents/run-coordinator.test.ts 2>&1 | tail -30
```

If tests fail due to constructor changes, update the test file to pass a mock `SessionRouter` instead of `StorageEngine`. The mock needs `route()`, `listSessions()`, `updateAfterTurn()` methods.

- [ ] **Step 9: Commit**

```bash
git add server/agents/run-coordinator.ts server/agents/run-coordinator.test.ts
git commit -m "feat(sessions): integrate SessionRouter and SessionManager into RunCoordinator"
```

---

### Task 10: Remove chat-store and clean up references

**Files:**
- Delete: `src/store/chat-store.ts`
- Modify: `src/App.tsx:47-49`

- [ ] **Step 1: Remove chat-store.ts**

```bash
rm src/store/chat-store.ts
```

- [ ] **Step 2: Remove localStorage cleanup in App.tsx**

In `src/App.tsx`, remove the block at lines 47-49 that references chat-store:

```typescript
    // Also clean up old chat-store localStorage key
    try {
      localStorage.removeItem('agent-manager-chats');
    } catch {
```

Remove both the comment and the try/catch block.

- [ ] **Step 3: Search for any remaining references**

```bash
grep -r "chat-store\|useChatStore" src/ --include="*.ts" --include="*.tsx" -l
```

Expected: no results (or only the spec file in docs/).

- [ ] **Step 4: Verify build**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors from chat-store removal.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated chat-store"
```

---

### Task 11: Update concept docs

**Files:**
- Modify: `docs/concepts/storage-node.md`
- Modify: `docs/concepts/context-engine-node.md`

- [ ] **Step 1: Read the manifest to find doc paths**

```bash
cat docs/concepts/_manifest.json
```

- [ ] **Step 2: Update storage-node.md**

Update the Configuration table to include the new reset fields:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| dailyResetEnabled | boolean | true | Reset sessions daily |
| dailyResetHour | number | 4 | Hour (0-23) for daily reset |
| idleResetEnabled | boolean | false | Reset after inactivity |
| idleResetMinutes | number | 60 | Idle timeout in minutes |
| parentForkMaxTokens | number | 100000 | Skip parent fork when transcript exceeds this |

Update the Runtime Behavior section to describe:
- `sessions.json` replaces `_index.json` as a key-value map
- SessionRouter handles routing and resets
- Transcript I/O delegates to pi-mono's SessionManager

Update `<!-- last-verified: 2026-04-07 -->`.

- [ ] **Step 3: Update context-engine-node.md**

Update the Runtime Behavior section to note:
- Compaction entries are written via SessionManager (`sm.appendCompaction()`)
- Compaction is per-session, not per-agent

Update `<!-- last-verified: 2026-04-07 -->`.

- [ ] **Step 4: Commit**

```bash
git add docs/concepts/storage-node.md docs/concepts/context-engine-node.md
git commit -m "docs: update storage and context engine docs for session management"
```

---

### Task 12: Run full test suite and verify

- [ ] **Step 1: Run all tests**

```bash
npx vitest run 2>&1 | tail -40
```

Expected: all tests pass. If any fail, fix them before proceeding.

- [ ] **Step 2: Run TypeScript compilation check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: resolve any remaining type errors from session management migration"
```
