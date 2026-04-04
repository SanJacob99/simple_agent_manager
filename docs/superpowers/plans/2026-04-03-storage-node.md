# Storage Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder `database` node with a fully functional `storage` node that persists agent sessions (JSONL), messages, and memory files to the filesystem.

**Architecture:** Hybrid approach (C) — direct filesystem `StorageEngine` class with clean method signatures for future interface extraction. The Zustand session store loses its `persist` middleware and becomes a thin in-memory cache that delegates all persistence to `StorageEngine`. The storage node becomes a required peripheral (blurred overlay gate in ChatDrawer).

**Tech Stack:** TypeScript, Node.js `fs/promises` + `path` + `os`, Zustand, Vitest, React 19, @xyflow/react

**Spec:** `docs/superpowers/specs/2026-04-03-storage-node-design.md`

---

### Task 1: Rename `database` → `storage` in type system

**Files:**
- Modify: `src/types/nodes.ts`

- [ ] **Step 1: Update the NodeType union and data interface**

In `src/types/nodes.ts`, replace the `database` entry in the `NodeType` union and replace `DatabaseNodeData` with `StorageNodeData`:

```ts
// In NodeType union, replace 'database' with:
| 'storage'

// Replace the DatabaseNodeData interface with:
export type StorageBackend = 'filesystem';

export interface StorageNodeData {
  [key: string]: unknown;
  type: 'storage';
  label: string;
  backendType: StorageBackend;
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;
}
```

Update the `FlowNodeData` union: replace `DatabaseNodeData` with `StorageNodeData`.

- [ ] **Step 2: Verify the project compiles**

Run: `npx tsc --noEmit 2>&1 | head -50`

Expected: Compilation errors in files that still reference `database`/`DatabaseNodeData`. This is expected — we'll fix them in subsequent tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types/nodes.ts
git commit -m "refactor: rename database → storage in node type definitions"
```

---

### Task 2: Update default node data

**Files:**
- Modify: `src/utils/default-nodes.ts`
- Modify: `src/utils/default-nodes.test.ts`

- [ ] **Step 1: Write a failing test for the storage default**

Add to `src/utils/default-nodes.test.ts`:

```ts
it('returns a storage node config with filesystem defaults', () => {
  const node = getDefaultNodeData('storage');

  expect(node.type).toBe('storage');
  expect(node.label).toBe('Storage');
  expect(node.backendType).toBe('filesystem');
  expect(node.storagePath).toBe('~/.simple-agent-manager/storage');
  expect(node.sessionRetention).toBe(50);
  expect(node.memoryEnabled).toBe(true);
  expect(node.dailyMemoryEnabled).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/default-nodes.test.ts`

Expected: FAIL — `'storage'` is not a valid case yet in `getDefaultNodeData`.

- [ ] **Step 3: Update the defaults implementation**

In `src/utils/default-nodes.ts`, replace the `case 'database'` block with:

```ts
case 'storage':
  return {
    type: 'storage',
    label: 'Storage',
    backendType: 'filesystem',
    storagePath: '~/.simple-agent-manager/storage',
    sessionRetention: 50,
    memoryEnabled: true,
    dailyMemoryEnabled: true,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/default-nodes.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/default-nodes.ts src/utils/default-nodes.test.ts
git commit -m "feat: add storage node defaults replacing database"
```

---

### Task 3: Update resolved config and graph-to-agent resolution

**Files:**
- Modify: `src/runtime/agent-config.ts`
- Modify: `src/utils/graph-to-agent.ts`
- Modify: `src/utils/graph-to-agent.test.ts`

- [ ] **Step 1: Write a failing test for storage resolution**

Add to `src/utils/graph-to-agent.test.ts`:

```ts
it('resolves a connected storage node into config.storage', () => {
  const config = resolveAgentConfig(
    'agent-1',
    [
      {
        id: 'agent-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {
          type: 'agent',
          name: 'Agent',
          nameConfirmed: true,
          systemPrompt: 'Test',
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
          thinkingLevel: 'off',
          description: '',
          tags: [],
          modelCapabilities: {},
        },
      },
      {
        id: 'storage-1',
        type: 'storage',
        position: { x: -200, y: 0 },
        data: {
          type: 'storage',
          label: 'Storage',
          backendType: 'filesystem',
          storagePath: '/home/user/.simple-agent-manager/storage',
          sessionRetention: 50,
          memoryEnabled: true,
          dailyMemoryEnabled: true,
        },
      },
    ] as any,
    [{ id: 'e1', source: 'storage-1', target: 'agent-1', type: 'data' }] as any,
  );

  expect(config?.storage).not.toBeNull();
  expect(config?.storage?.backendType).toBe('filesystem');
  expect(config?.storage?.storagePath).toBe('/home/user/.simple-agent-manager/storage');
  expect(config?.storage?.sessionRetention).toBe(50);
  expect(config?.storage?.memoryEnabled).toBe(true);
});

it('returns storage as null when no storage node is connected', () => {
  const config = resolveAgentConfig(
    'agent-1',
    [
      {
        id: 'agent-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {
          type: 'agent',
          name: 'Agent',
          nameConfirmed: true,
          systemPrompt: 'Test',
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
          thinkingLevel: 'off',
          description: '',
          tags: [],
          modelCapabilities: {},
        },
      },
    ] as any,
    [],
  );

  expect(config?.storage).toBeNull();
});

it('expands tilde in storage path during resolution', () => {
  const config = resolveAgentConfig(
    'agent-1',
    [
      {
        id: 'agent-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: {
          type: 'agent',
          name: 'Agent',
          nameConfirmed: true,
          systemPrompt: 'Test',
          provider: 'anthropic',
          modelId: 'claude-sonnet-4-20250514',
          thinkingLevel: 'off',
          description: '',
          tags: [],
          modelCapabilities: {},
        },
      },
      {
        id: 'storage-1',
        type: 'storage',
        position: { x: -200, y: 0 },
        data: {
          type: 'storage',
          label: 'Storage',
          backendType: 'filesystem',
          storagePath: '~/.simple-agent-manager/storage',
          sessionRetention: 50,
          memoryEnabled: true,
          dailyMemoryEnabled: true,
        },
      },
    ] as any,
    [{ id: 'e1', source: 'storage-1', target: 'agent-1', type: 'data' }] as any,
  );

  expect(config?.storage?.storagePath).not.toContain('~');
  expect(config?.storage?.storagePath).toMatch(/^\//); // absolute path on unix, or drive letter on win
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/graph-to-agent.test.ts`

Expected: FAIL — `config.storage` doesn't exist, `databases` still does.

- [ ] **Step 3: Update `ResolvedStorageConfig` in agent-config.ts**

In `src/runtime/agent-config.ts`:

Remove `ResolvedDatabaseConfig`. Add:

```ts
export interface ResolvedStorageConfig {
  label: string;
  backendType: 'filesystem';
  storagePath: string;
  sessionRetention: number;
  memoryEnabled: boolean;
  dailyMemoryEnabled: boolean;
}
```

In the `AgentConfig` interface, replace `databases: ResolvedDatabaseConfig[]` with `storage: ResolvedStorageConfig | null`.

- [ ] **Step 4: Update graph-to-agent.ts**

In `src/utils/graph-to-agent.ts`:

Add at the top (after existing imports):

```ts
import os from 'os';
```

Replace the `// --- Databases ---` section with:

```ts
// --- Storage ---
const storageNode = connectedNodes.find((n) => n.data.type === 'storage');
const storage = storageNode && storageNode.data.type === 'storage'
  ? {
      label: storageNode.data.label,
      backendType: storageNode.data.backendType,
      storagePath: storageNode.data.storagePath.startsWith('~')
        ? storageNode.data.storagePath.replace('~', os.homedir())
        : storageNode.data.storagePath,
      sessionRetention: storageNode.data.sessionRetention,
      memoryEnabled: storageNode.data.memoryEnabled,
      dailyMemoryEnabled: storageNode.data.dailyMemoryEnabled,
    }
  : null;
```

In the return object, replace `databases,` with `storage,`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/utils/graph-to-agent.test.ts`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/agent-config.ts src/utils/graph-to-agent.ts src/utils/graph-to-agent.test.ts
git commit -m "feat: add storage config resolution with tilde expansion"
```

---

### Task 4: Create `StorageEngine` runtime class

**Files:**
- Create: `src/runtime/storage-engine.ts`
- Create: `src/runtime/storage-engine.test.ts`

- [ ] **Step 1: Write failing tests for StorageEngine core operations**

Create `src/runtime/storage-engine.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { StorageEngine } from './storage-engine';
import type { ResolvedStorageConfig } from './agent-config';

function makeTempConfig(overrides?: Partial<ResolvedStorageConfig>): ResolvedStorageConfig {
  return {
    label: 'Test Storage',
    backendType: 'filesystem',
    storagePath: path.join(os.tmpdir(), `sam-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    sessionRetention: 50,
    memoryEnabled: true,
    dailyMemoryEnabled: true,
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
      const sessionsStat = await fs.stat(sessionsDir);
      const memoryStat = await fs.stat(memoryDir);
      expect(sessionsStat.isDirectory()).toBe(true);
      expect(memoryStat.isDirectory()).toBe(true);
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

  describe('session CRUD', () => {
    it('creates a session and lists it', async () => {
      await engine.createSession({
        sessionId: 'sess-1',
        agentName: 'test-agent',
        llmSlug: 'anthropic/claude-sonnet-4-20250514',
        startedAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        sessionFile: 'sessions/sess-1.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      });

      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-1');
    });

    it('deletes a session and its JSONL file', async () => {
      await engine.createSession({
        sessionId: 'sess-del',
        agentName: 'test-agent',
        llmSlug: 'anthropic/claude-sonnet-4-20250514',
        startedAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        sessionFile: 'sessions/sess-del.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      });

      await engine.deleteSession('sess-del');
      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(0);
    });

    it('updates session metadata partially', async () => {
      await engine.createSession({
        sessionId: 'sess-upd',
        agentName: 'test-agent',
        llmSlug: 'anthropic/claude-sonnet-4-20250514',
        startedAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        sessionFile: 'sessions/sess-upd.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      });

      await engine.updateSessionMeta('sess-upd', {
        totalInputTokens: 5000,
        totalOutputTokens: 1200,
        totalTokens: 6200,
        updatedAt: '2026-04-03T10:15:00.000Z',
      });

      const meta = await engine.getSessionMeta('sess-upd');
      expect(meta?.totalInputTokens).toBe(5000);
      expect(meta?.totalOutputTokens).toBe(1200);
      expect(meta?.totalTokens).toBe(6200);
    });
  });

  describe('JSONL entries', () => {
    it('appends and reads session entries', async () => {
      await engine.createSession({
        sessionId: 'sess-jsonl',
        agentName: 'test-agent',
        llmSlug: 'anthropic/claude-sonnet-4-20250514',
        startedAt: '2026-04-03T10:00:00.000Z',
        updatedAt: '2026-04-03T10:00:00.000Z',
        sessionFile: 'sessions/sess-jsonl.jsonl',
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      });

      await engine.appendEntry('sess-jsonl', {
        type: 'session',
        id: 'entry-1',
        parentId: null,
        timestamp: '2026-04-03T10:00:00.000Z',
        version: 3,
        sessionId: 'sess-jsonl',
      });

      await engine.appendEntry('sess-jsonl', {
        type: 'message',
        id: 'entry-2',
        parentId: 'entry-1',
        timestamp: '2026-04-03T10:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      });

      const entries = await engine.readEntries('sess-jsonl');
      expect(entries).toHaveLength(2);
      expect(entries[0].type).toBe('session');
      expect(entries[1].type).toBe('message');
      expect(entries[1].parentId).toBe('entry-1');
    });
  });

  describe('session retention', () => {
    it('prunes oldest sessions beyond retention limit', async () => {
      for (let i = 0; i < 5; i++) {
        await engine.createSession({
          sessionId: `sess-${i}`,
          agentName: 'test-agent',
          llmSlug: 'anthropic/claude-sonnet-4-20250514',
          startedAt: `2026-04-0${i + 1}T10:00:00.000Z`,
          updatedAt: `2026-04-0${i + 1}T10:00:00.000Z`,
          sessionFile: `sessions/sess-${i}.jsonl`,
          contextTokens: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalEstimatedCostUsd: 0,
          totalTokens: 0,
        });
      }

      await engine.enforceRetention(3);
      const sessions = await engine.listSessions();
      expect(sessions).toHaveLength(3);
      // Newest 3 should remain (sess-4, sess-3, sess-2)
      const ids = sessions.map((s) => s.sessionId);
      expect(ids).toContain('sess-4');
      expect(ids).toContain('sess-3');
      expect(ids).toContain('sess-2');
      expect(ids).not.toContain('sess-0');
      expect(ids).not.toContain('sess-1');
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
      const daily = await engine.readDailyMemory('2020-01-01');
      expect(daily).toBeNull();

      const longTerm = await engine.readLongTermMemory();
      expect(longTerm).toBeNull();
    });

    it('lists memory files with metadata', async () => {
      await engine.writeLongTermMemory('# Memory');
      await engine.appendDailyMemory('Note', '2026-04-03');

      const files = await engine.listMemoryFiles();
      expect(files.length).toBeGreaterThanOrEqual(2);

      const longTermFile = files.find((f) => f.name === 'MEMORY.md');
      expect(longTermFile?.isEvergreen).toBe(true);
      expect(longTermFile?.date).toBeNull();

      const dailyFile = files.find((f) => f.name === '2026-04-03.md');
      expect(dailyFile?.isEvergreen).toBe(false);
      expect(dailyFile?.date).toBe('2026-04-03');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/runtime/storage-engine.test.ts`

Expected: FAIL — `StorageEngine` doesn't exist yet.

- [ ] **Step 3: Implement StorageEngine**

Create `src/runtime/storage-engine.ts`:

```ts
import fs from 'fs/promises';
import path from 'path';
import type { ResolvedStorageConfig } from './agent-config';

// --- Types ---

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
    this.agentDir = path.join(config.storagePath, agentName);
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

    // Create empty JSONL file
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

  // --- Retention ---

  async enforceRetention(maxSessions: number): Promise<void> {
    const sessions = await this.listSessions(); // sorted by updatedAt desc
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/runtime/storage-engine.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/storage-engine.ts src/runtime/storage-engine.test.ts
git commit -m "feat: implement StorageEngine with filesystem persistence"
```

---

### Task 5: Update node UI components (StorageNode + StorageProperties)

**Files:**
- Modify: `src/nodes/DatabaseNode.tsx` → rename to `src/nodes/StorageNode.tsx`
- Modify: `src/panels/property-editors/DatabaseProperties.tsx` → rename to `src/panels/property-editors/StorageProperties.tsx`
- Modify: `src/nodes/node-registry.ts`
- Modify: `src/panels/PropertiesPanel.tsx`

- [ ] **Step 1: Create StorageNode.tsx (replacing DatabaseNode.tsx)**

Delete `src/nodes/DatabaseNode.tsx` and create `src/nodes/StorageNode.tsx`:

```tsx
import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Database } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { StorageNodeData } from '../types/nodes';

type StorageNode = Node<StorageNodeData>;

function StorageNodeComponent({ data, selected }: NodeProps<StorageNode>) {
  return (
    <BasePeripheralNode
      nodeType="storage"
      label={data.label}
      icon={<Database size={14} />}
      selected={selected}
    >
      <div>Backend: {data.backendType}</div>
      <div className="truncate">
        {data.storagePath || 'Not configured'}
      </div>
    </BasePeripheralNode>
  );
}

export default memo(StorageNodeComponent);
```

- [ ] **Step 2: Create StorageProperties.tsx (replacing DatabaseProperties.tsx)**

Delete `src/panels/property-editors/DatabaseProperties.tsx` and create `src/panels/property-editors/StorageProperties.tsx`:

```tsx
import { useGraphStore } from '../../store/graph-store';
import type { StorageNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: StorageNodeData;
}

export default function StorageProperties({ nodeId, data }: Props) {
  const update = useGraphStore((s) => s.updateNodeData);

  return (
    <div className="space-y-1">
      <Field label="Label">
        <input
          className={inputClass}
          value={data.label}
          onChange={(e) => update(nodeId, { label: e.target.value })}
        />
      </Field>

      <Field label="Backend">
        <select
          className={selectClass}
          value={data.backendType}
          onChange={(e) =>
            update(nodeId, {
              backendType: e.target.value as StorageNodeData['backendType'],
            })
          }
        >
          <option value="filesystem">Filesystem</option>
        </select>
      </Field>

      <Field label="Storage Path">
        <input
          className={inputClass}
          value={data.storagePath}
          onChange={(e) => update(nodeId, { storagePath: e.target.value })}
          placeholder="~/.simple-agent-manager/storage"
        />
      </Field>

      <Field label="Session Retention">
        <input
          className={inputClass}
          type="number"
          min={1}
          value={data.sessionRetention}
          onChange={(e) =>
            update(nodeId, { sessionRetention: parseInt(e.target.value, 10) || 50 })
          }
        />
      </Field>

      <Field label="Memory">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={data.memoryEnabled}
            onChange={(e) => update(nodeId, { memoryEnabled: e.target.checked })}
          />
          Enable memory files
        </label>
      </Field>

      {data.memoryEnabled && (
        <Field label="Daily Memory">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={data.dailyMemoryEnabled}
              onChange={(e) =>
                update(nodeId, { dailyMemoryEnabled: e.target.checked })
              }
            />
            Maintain daily logs
          </label>
        </Field>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update node-registry.ts**

In `src/nodes/node-registry.ts`, replace the `DatabaseNode` import and entry:

```ts
import StorageNode from './StorageNode';

// In the nodeTypes object, replace:
//   database: DatabaseNode,
// with:
  storage: StorageNode,
```

Remove the `DatabaseNode` import.

- [ ] **Step 4: Update PropertiesPanel.tsx**

In `src/panels/PropertiesPanel.tsx`:

Replace the `DatabaseProperties` import with:
```ts
import StorageProperties from './property-editors/StorageProperties';
```

Replace the `case 'database':` block with:
```ts
case 'storage':
  return <StorageProperties nodeId={nodeId} data={data} />;
```

- [ ] **Step 5: Delete old files**

Delete `src/nodes/DatabaseNode.tsx` and `src/panels/property-editors/DatabaseProperties.tsx`.

- [ ] **Step 6: Commit**

```bash
git add src/nodes/StorageNode.tsx src/panels/property-editors/StorageProperties.tsx \
  src/nodes/node-registry.ts src/panels/PropertiesPanel.tsx
git rm src/nodes/DatabaseNode.tsx src/panels/property-editors/DatabaseProperties.tsx
git commit -m "feat: replace DatabaseNode UI with StorageNode"
```

---

### Task 6: Update theme, sidebar, CSS, and test fixture

**Files:**
- Modify: `src/utils/theme.ts`
- Modify: `src/panels/Sidebar.tsx`
- Modify: `src/app.css`
- Modify: `src/fixtures/test-graph.json`

- [ ] **Step 1: Update theme.ts**

In `src/utils/theme.ts`, replace both `database` entries with `storage`:

In `NODE_COLORS`:
```ts
storage: '#ef4444',
```

In `NODE_LABELS`:
```ts
storage: 'Storage',
```

- [ ] **Step 2: Update Sidebar.tsx**

In `src/panels/Sidebar.tsx`, replace the `database` palette item:

```ts
{ type: 'database', icon: <Database size={16} /> },
```
with:
```ts
{ type: 'storage', icon: <Database size={16} /> },
```

The `Database` icon import from lucide-react stays the same.

- [ ] **Step 3: Update app.css**

Replace `--color-node-database: #ef4444;` with:
```css
--color-node-storage: #ef4444;
```

- [ ] **Step 4: Update test fixture**

In `src/fixtures/test-graph.json`, replace the database node and edge:

Node: change `"id": "database-1"`, `"type": "database"`, and `"data": { "type": "database", ... }` to use `storage` type with the new data shape:

```json
{
  "id": "storage-1",
  "type": "storage",
  "position": { "x": 100, "y": 530 },
  "data": {
    "type": "storage",
    "label": "Storage",
    "backendType": "filesystem",
    "storagePath": "~/.simple-agent-manager/storage",
    "sessionRetention": 50,
    "memoryEnabled": true,
    "dailyMemoryEnabled": true
  }
}
```

Edge: change `"id": "edge_database-1_agent-1"` to `"edge_storage-1_agent-1"`, and `"source": "database-1"` to `"source": "storage-1"`.

- [ ] **Step 5: Verify compilation**

Run: `npx tsc --noEmit`

Expected: No errors (or only errors from session-store which we fix in Task 7).

- [ ] **Step 6: Commit**

```bash
git add src/utils/theme.ts src/panels/Sidebar.tsx src/app.css src/fixtures/test-graph.json
git commit -m "refactor: update theme, sidebar, CSS, and fixture for storage node"
```

---

### Task 7: Update ChatDrawer overlay (add storage gate, remove tools gate)

**Files:**
- Modify: `src/chat/ChatDrawer.tsx`

- [ ] **Step 1: Update the missingPeripherals logic**

In `src/chat/ChatDrawer.tsx`, find the `missingPeripherals` useMemo block (around line 347). Replace it with:

```ts
const missingPeripherals = useMemo(() => {
  if (!config) return [];
  const missing: { key: string; label: string; description: string; hint: string }[] = [];

  if (!config.contextEngine) {
    missing.push({
      key: 'contextEngine',
      label: 'Context Engine Required',
      description:
        'A Context Engine manages the conversation\'s token budget, compaction strategy, and memory window. Without it, the agent cannot track how much context is available, when to summarize or trim history, or how to allocate space for tools and system prompts.',
      hint: 'Drag a Context Engine node onto the canvas and connect it to this agent to enable chat.',
    });
  }

  if (!config.storage) {
    missing.push({
      key: 'storage',
      label: 'Storage Required',
      description:
        'A Storage node defines where sessions, messages, and memory files are persisted. Without it, the agent has nowhere to save conversation history.',
      hint: 'Drag a Storage node onto the canvas and connect it to this agent.',
    });
  }

  return missing;
}, [config]);
```

This removes the tools gate and adds the storage gate.

- [ ] **Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`

Expected: No type errors related to `config.storage` (it was added in Task 3).

- [ ] **Step 3: Commit**

```bash
git add src/chat/ChatDrawer.tsx
git commit -m "feat: add storage overlay gate, remove tools gate from ChatDrawer"
```

---

### Task 8: Rewire session store to delegate to StorageEngine

**Files:**
- Modify: `src/store/session-store.ts`

- [ ] **Step 1: Refactor session-store to thin in-memory cache**

Rewrite `src/store/session-store.ts`. The store keeps the same public API but removes `persist` middleware. It gains a `bindStorage(engine: StorageEngine)` method and delegates all persistence to the engine.

```ts
import { create } from 'zustand';
import type { StorageEngine, SessionMeta, SessionEntry } from '../runtime/storage-engine';

// ── Message types ──────────────────────────────────────────────────────────

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

// ── Session type ───────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  agentName: string;
  llmSlug: string;
  createdAt: number;
  lastMessageAt: number;
  messages: Message[];
}

// ── Store ──────────────────────────────────────────────────────────────────

interface SessionStore {
  /** All sessions keyed by session ID */
  sessions: Record<string, ChatSession>;
  /** Maps nodeId → active sessionId */
  activeSessionId: Record<string, string>;
  /** Bound storage engine (null until a storage node is connected) */
  storageEngine: StorageEngine | null;

  // Storage binding
  bindStorage: (engine: StorageEngine) => void;
  unbindStorage: () => void;
  loadSessionsFromDisk: () => Promise<void>;

  // Session lifecycle
  createSession: (
    agentName: string,
    provider: string,
    modelId: string,
    isDefault?: boolean,
  ) => Promise<string>;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteAllSessionsForAgent: (agentName: string) => Promise<void>;

  // Active session mapping
  setActiveSession: (nodeId: string, sessionId: string) => void;
  getActiveSessionId: (nodeId: string) => string | null;
  clearActiveSession: (nodeId: string) => void;

  // Message operations
  addMessage: (sessionId: string, message: Message) => Promise<void>;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updater: (msg: Message) => Message,
  ) => void;
  clearSessionMessages: (sessionId: string) => Promise<void>;

  // Querying
  getSessionsForAgent: (agentName: string) => ChatSession[];

  // Maintenance
  enforceSessionLimit: (agentName: string, maxSessions?: number) => Promise<void>;
  resetAllSessions: () => void;
}

function buildSessionId(agentName: string, provider: string, modelId: string): string {
  const slug = `${provider}/${modelId}`;
  const hash = Math.random().toString(36).slice(2, 10);
  return `${agentName}:${slug}:${hash}`;
}

export const useSessionStore = create<SessionStore>()(
  (set, get) => ({
    sessions: {},
    activeSessionId: {},
    storageEngine: null,

    bindStorage: (engine) => {
      set({ storageEngine: engine });
    },

    unbindStorage: () => {
      set({ storageEngine: null, sessions: {}, activeSessionId: {} });
    },

    loadSessionsFromDisk: async () => {
      const { storageEngine } = get();
      if (!storageEngine) return;

      const metas = await storageEngine.listSessions();
      const sessions: Record<string, ChatSession> = {};

      for (const meta of metas) {
        const entries = await storageEngine.readEntries(meta.sessionId);
        const messages: Message[] = entries
          .filter((e) => e.type === 'message' && e.message)
          .map((e) => {
            const msg = e.message as { role: string; content: unknown; timestamp?: number };
            const content = typeof msg.content === 'string'
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content.map((c: { text?: string }) => c.text ?? '').join('')
                : '';
            return {
              id: e.id,
              role: msg.role as 'user' | 'assistant' | 'tool',
              content,
              timestamp: msg.timestamp ?? new Date(e.timestamp).getTime(),
            };
          });

        sessions[meta.sessionId] = {
          id: meta.sessionId,
          agentName: meta.agentName,
          llmSlug: meta.llmSlug,
          createdAt: new Date(meta.startedAt).getTime(),
          lastMessageAt: new Date(meta.updatedAt).getTime(),
          messages,
        };
      }

      set({ sessions });
    },

    createSession: async (agentName, provider, modelId, _isDefault = false) => {
      const id = buildSessionId(agentName, provider, modelId);
      const now = Date.now();
      const slug = `${provider}/${modelId}`;
      const nowIso = new Date(now).toISOString();

      const meta: SessionMeta = {
        sessionId: id,
        agentName,
        llmSlug: slug,
        startedAt: nowIso,
        updatedAt: nowIso,
        sessionFile: `sessions/${id}.jsonl`,
        contextTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalEstimatedCostUsd: 0,
        totalTokens: 0,
      };

      const { storageEngine } = get();
      if (storageEngine) {
        await storageEngine.createSession(meta);
      }

      set((state) => ({
        sessions: {
          ...state.sessions,
          [id]: {
            id,
            agentName,
            llmSlug: slug,
            createdAt: now,
            lastMessageAt: now,
            messages: [],
          },
        },
      }));

      return id;
    },

    deleteSession: async (sessionId) => {
      const { storageEngine } = get();
      if (storageEngine) {
        await storageEngine.deleteSession(sessionId);
      }

      set((state) => {
        const { [sessionId]: _, ...rest } = state.sessions;
        const nextActive = { ...state.activeSessionId };
        for (const [nodeId, activeId] of Object.entries(nextActive)) {
          if (activeId === sessionId) delete nextActive[nodeId];
        }
        return { sessions: rest, activeSessionId: nextActive };
      });
    },

    deleteAllSessionsForAgent: async (agentName) => {
      const { storageEngine } = get();
      const toDelete = Object.values(get().sessions).filter(
        (s) => s.agentName === agentName,
      );

      if (storageEngine) {
        for (const s of toDelete) {
          await storageEngine.deleteSession(s.id);
        }
      }

      set((state) => {
        const nextSessions: Record<string, ChatSession> = {};
        const nextActive = { ...state.activeSessionId };

        for (const [id, session] of Object.entries(state.sessions)) {
          if (session.agentName !== agentName) nextSessions[id] = session;
        }
        for (const [nodeId, activeId] of Object.entries(nextActive)) {
          if (!(activeId in nextSessions)) delete nextActive[nodeId];
        }
        return { sessions: nextSessions, activeSessionId: nextActive };
      });
    },

    setActiveSession: (nodeId, sessionId) => {
      set((state) => ({
        activeSessionId: { ...state.activeSessionId, [nodeId]: sessionId },
      }));
    },

    getActiveSessionId: (nodeId) => get().activeSessionId[nodeId] ?? null,

    clearActiveSession: (nodeId) => {
      set((state) => {
        const { [nodeId]: _, ...rest } = state.activeSessionId;
        return { activeSessionId: rest };
      });
    },

    addMessage: async (sessionId, message) => {
      const { storageEngine } = get();
      if (storageEngine) {
        const entry: SessionEntry = {
          type: 'message',
          id: message.id,
          parentId: null, // will be set by caller if needed
          timestamp: new Date(message.timestamp).toISOString(),
          message: {
            role: message.role,
            content: [{ type: 'text', text: message.content }],
            timestamp: message.timestamp,
          },
        };
        await storageEngine.appendEntry(sessionId, entry);
        await storageEngine.updateSessionMeta(sessionId, {
          updatedAt: new Date().toISOString(),
        });
      }

      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              messages: [...session.messages, message],
              lastMessageAt: Date.now(),
            },
          },
        };
      });
    },

    updateMessage: (sessionId, messageId, updater) => {
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              messages: session.messages.map((m) =>
                m.id === messageId ? updater(m) : m,
              ),
              lastMessageAt: Date.now(),
            },
          },
        };
      });
    },

    clearSessionMessages: async (sessionId) => {
      // Note: this clears in-memory only. The JSONL file is append-only.
      // A future version could rewrite the file.
      set((state) => {
        const session = state.sessions[sessionId];
        if (!session) return state;
        return {
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...session,
              messages: [],
              lastMessageAt: Date.now(),
            },
          },
        };
      });
    },

    getSessionsForAgent: (agentName) => {
      const { sessions } = get();
      return Object.values(sessions)
        .filter((s) => s.agentName === agentName)
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    },

    enforceSessionLimit: async (agentName, maxSessions = 50) => {
      const { storageEngine } = get();
      if (storageEngine) {
        await storageEngine.enforceRetention(maxSessions);
      }

      set((state) => {
        const agentSessions = Object.values(state.sessions)
          .filter((s) => s.agentName === agentName)
          .sort((a, b) => b.lastMessageAt - a.lastMessageAt);

        if (agentSessions.length <= maxSessions) return state;

        const toKeep = new Set(
          agentSessions.slice(0, maxSessions).map((s) => s.id),
        );
        const nextSessions: Record<string, ChatSession> = {};
        const nextActive = { ...state.activeSessionId };

        for (const [id, session] of Object.entries(state.sessions)) {
          if (session.agentName !== agentName || toKeep.has(id)) {
            nextSessions[id] = session;
          }
        }
        for (const [nodeId, activeId] of Object.entries(nextActive)) {
          if (!(activeId in nextSessions)) delete nextActive[nodeId];
        }
        return { sessions: nextSessions, activeSessionId: nextActive };
      });
    },

    resetAllSessions: () => {
      set({ sessions: {}, activeSessionId: {} });
    },
  }),
);
```

- [ ] **Step 2: Update ChatDrawer to handle async session operations**

In `src/chat/ChatDrawer.tsx`, the `createSession`, `deleteSession`, `addMessage`, and `clearSessionMessages` calls now return Promises. Wrap these calls with proper async handling where they are called (e.g., `handleSend`, `handleNewSession`). The key changes are:

- `createSession(...)` → `await createSession(...)`
- `deleteSession(...)` → `await deleteSession(...)`
- `addMessage(...)` → `await addMessage(...)`

Since `handleSend` is likely already async (it streams from the runtime), these should drop in naturally. Add `.catch(console.error)` to fire-and-forget calls in event handlers.

- [ ] **Step 3: Verify the build compiles**

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`

Expected: All tests pass. The `session-store.test.ts` doesn't exist (sessions were tested indirectly), so no test breakage expected from the store rewrite.

- [ ] **Step 5: Delete unused session-id utility**

The old `src/utils/session-id.ts` is no longer imported by anything after the store rewrite. Delete it:

```bash
git rm src/utils/session-id.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/store/session-store.ts src/chat/ChatDrawer.tsx
git rm src/utils/session-id.ts
git commit -m "feat: rewire session store to delegate persistence to StorageEngine"
```

---

### Task 9: Update concept docs

**Files:**
- Delete: `docs/concepts/database-node.md`
- Create: `docs/concepts/storage-node.md`
- Modify: `docs/concepts/_manifest.json`

- [ ] **Step 1: Read the template**

Read `docs/concepts/_template.md` for the expected structure.

- [ ] **Step 2: Create storage-node.md**

Create `docs/concepts/storage-node.md` following the template. Key sections:

- **Purpose:** Filesystem-based persistence for agent sessions, messages, and memory files
- **Configuration table:** All `StorageNodeData` fields with types and defaults
- **Runtime Behavior:** `StorageEngine` class, directory structure, JSONL format, memory file conventions
- **Connections:** Connects to agent node (singular, like contextEngine)

- [ ] **Step 3: Update _manifest.json**

Replace the `"database"` entry with:

```json
"storage": {
  "doc": "storage-node.md",
  "type": "src/types/nodes.ts#StorageNodeData",
  "runtime": "src/runtime/storage-engine.ts"
}
```

- [ ] **Step 4: Delete old database-node.md**

Delete `docs/concepts/database-node.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/concepts/storage-node.md docs/concepts/_manifest.json
git rm docs/concepts/database-node.md
git commit -m "docs: replace database concept doc with storage node"
```

---

### Task 10: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`

Expected: All tests pass.

- [ ] **Step 2: Type check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: Build succeeds.

- [ ] **Step 4: Verify no remaining references to `database` (as node type)**

Run: `grep -rn "\"database\"" src/ --include="*.ts" --include="*.tsx" --include="*.json" | grep -v node_modules | grep -v vectorDatabase`

Expected: No matches (all `database` references replaced with `storage`). `vectorDatabase` references should still exist and are correct.
