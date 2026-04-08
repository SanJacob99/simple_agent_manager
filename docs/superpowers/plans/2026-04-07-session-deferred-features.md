# Session Deferred Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement session tools (7 agent tools), cron/webhook sessions, maintenance controls, and tree navigation UI — the four deferred subsystems from the session management design.

**Architecture:** Four layers built incrementally: (1) Maintenance controls extend `StorageEngine` with disk budgets, pruning, and background scheduling; (2) Session tools give agents cross-session inspection, messaging, and sub-agent orchestration via a `SubAgentRegistry`; (3) A new `CronNode` type + `CronScheduler` service enables scheduled agent runs, with lightweight webhook routes at the server level; (4) Tree navigation UI adds branch indicators and a lineage breadcrumb to the chat timeline.

**Tech Stack:** TypeScript, Vitest, Express, Zustand, `@xyflow/react`, `@mariozechner/pi-coding-agent`, `@sinclair/typebox`, `node-cron`, `lucide-react`

**Spec:** `docs/superpowers/specs/2026-04-07-session-deferred-features-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `server/runtime/maintenance-scheduler.ts` | Background maintenance interval timer |
| `server/runtime/maintenance-scheduler.test.ts` | MaintenanceScheduler unit tests |
| `server/runtime/sub-agent-registry.ts` | Sub-agent spawn tracking, yield coordination |
| `server/runtime/sub-agent-registry.test.ts` | SubAgentRegistry unit tests |
| `server/runtime/session-tools.ts` | 7 session tool implementations |
| `server/runtime/session-tools.test.ts` | Session tools unit tests |
| `server/runtime/cron-scheduler.ts` | Cron job scheduling via node-cron |
| `server/runtime/cron-scheduler.test.ts` | CronScheduler unit tests |
| `server/runtime/webhook-handler.ts` | Webhook route registration and dispatch |
| `src/nodes/CronNode.tsx` | Cron node canvas component |
| `src/panels/property-editors/CronProperties.tsx` | Cron node property editor |
| `src/components/BranchIndicator.tsx` | Fork point indicator in timeline |
| `src/components/BranchSwitcher.tsx` | Branch selection popover |
| `src/components/SessionLineageBar.tsx` | Parent session breadcrumb |

### Modified files
| File | Change |
|------|--------|
| `src/types/nodes.ts` | Add `CronNodeData`, maintenance fields to `StorageNodeData`, update unions |
| `src/utils/default-nodes.ts` | Add cron defaults, maintenance defaults to storage |
| `shared/agent-config.ts` | Add `ResolvedCronConfig`, maintenance fields to `ResolvedStorageConfig`, `crons` to `AgentConfig` |
| `shared/storage-types.ts` | Add `parentSessionId`, `ForkPoint`, `BranchInfo`, `BranchTree`, `SessionLineage`, `MaintenanceReport` |
| `shared/session-routes.ts` | Add `cronJobId?`, `webhookId?` to `SessionRouteRequest` |
| `shared/resolve-tool-names.ts` | Add session tool names to `ALL_TOOL_NAMES`, add `sessions` group |
| `src/utils/graph-to-agent.ts` | Resolve cron nodes, pass maintenance fields |
| `src/utils/theme.ts` | Add `cron` to `NODE_COLORS` and `NODE_LABELS` |
| `server/runtime/tool-factory.ts` | Add session tool names, `createSessionTools` export |
| `server/runtime/storage-engine.ts` | Add maintenance methods |
| `server/runtime/storage-engine.test.ts` | Add maintenance method tests |
| `server/runtime/session-router.ts` | Handle `cron:*`/`hook:*` keys, set `parentSessionId` on fork |
| `server/runtime/session-transcript-store.ts` | Add `buildBranchTree` method |
| `server/agents/run-coordinator.ts` | Inject session tools, integrate SubAgentRegistry |
| `server/index.ts` | Add maintenance, webhook, branch/lineage endpoints |
| `src/runtime/storage-client.ts` | Add maintenance, branch, lineage client methods |
| `src/store/session-store.ts` | Add `activeBranch`, branch tree/lineage actions |
| `src/nodes/node-registry.ts` | Register `cron: CronNode` |
| `src/panels/PropertiesPanel.tsx` | Add `case 'cron'` |
| `src/panels/property-editors/StorageProperties.tsx` | Add Maintenance config section |
| `src/settings/sections/DataMaintenanceSection.tsx` | Add "Run Maintenance" button |
| `package.json` | Add `node-cron`, `@types/node-cron` |

---

### Task 1: Maintenance types + config plumbing

**Files:**
- Modify: `src/types/nodes.ts:155-169`
- Modify: `shared/agent-config.ts:170-182`
- Modify: `src/utils/default-nodes.ts:88-102`
- Modify: `src/utils/graph-to-agent.ts:130-146`
- Modify: `shared/storage-types.ts:27-67`

- [ ] **Step 1: Add MaintenanceReport to shared/storage-types.ts**

Add after the `MemoryFileInfo` interface at the end of the file:

```typescript
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
```

- [ ] **Step 2: Add maintenance fields to StorageNodeData**

In `src/types/nodes.ts`, add 8 fields after `parentForkMaxTokens` inside `StorageNodeData`:

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
  // Maintenance
  maintenanceMode: 'warn' | 'enforce';
  pruneAfterDays: number;
  maxEntries: number;
  rotateBytes: number;
  resetArchiveRetentionDays: number;
  maxDiskBytes: number;
  highWaterPercent: number;
  maintenanceIntervalMinutes: number;
}
```

- [ ] **Step 3: Add maintenance fields to ResolvedStorageConfig**

In `shared/agent-config.ts`, add 8 fields after `parentForkMaxTokens` inside `ResolvedStorageConfig`:

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
  // Maintenance
  maintenanceMode: 'warn' | 'enforce';
  pruneAfterDays: number;
  maxEntries: number;
  rotateBytes: number;
  resetArchiveRetentionDays: number;
  maxDiskBytes: number;
  highWaterPercent: number;
  maintenanceIntervalMinutes: number;
}
```

- [ ] **Step 4: Add maintenance defaults to default-nodes.ts**

In `src/utils/default-nodes.ts`, extend the `storage` case. After `parentForkMaxTokens: 100000,` add:

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
        maintenanceMode: 'warn',
        pruneAfterDays: 30,
        maxEntries: 500,
        rotateBytes: 10_485_760,
        resetArchiveRetentionDays: 30,
        maxDiskBytes: 0,
        highWaterPercent: 80,
        maintenanceIntervalMinutes: 60,
      };
```

- [ ] **Step 5: Pass maintenance fields through in graph-to-agent.ts**

In `src/utils/graph-to-agent.ts`, extend the storage resolution block (lines 132-146). Add the 8 maintenance fields after `parentForkMaxTokens`:

```typescript
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
        maintenanceMode: storageNode.data.maintenanceMode,
        pruneAfterDays: storageNode.data.pruneAfterDays,
        maxEntries: storageNode.data.maxEntries,
        rotateBytes: storageNode.data.rotateBytes,
        resetArchiveRetentionDays: storageNode.data.resetArchiveRetentionDays,
        maxDiskBytes: storageNode.data.maxDiskBytes,
        highWaterPercent: storageNode.data.highWaterPercent,
        maintenanceIntervalMinutes: storageNode.data.maintenanceIntervalMinutes,
      }
    : null;
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to the new maintenance fields.

- [ ] **Step 7: Commit**

```bash
git add src/types/nodes.ts shared/agent-config.ts src/utils/default-nodes.ts src/utils/graph-to-agent.ts shared/storage-types.ts
git commit -m "feat: add maintenance control types and config plumbing"
```

---

### Task 2: StorageEngine maintenance methods (TDD)

**Files:**
- Modify: `server/runtime/storage-engine.ts`
- Modify: `server/runtime/storage-engine.test.ts`

- [ ] **Step 1: Update makeTempConfig helper in tests**

In `server/runtime/storage-engine.test.ts`, update `makeTempConfig` to include the new maintenance fields:

```typescript
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
    maintenanceMode: 'warn',
    pruneAfterDays: 30,
    maxEntries: 500,
    rotateBytes: 10_485_760,
    resetArchiveRetentionDays: 30,
    maxDiskBytes: 0,
    highWaterPercent: 80,
    maintenanceIntervalMinutes: 60,
    ...overrides,
  };
}
```

- [ ] **Step 2: Write failing tests for getDiskUsage**

Add a new `describe('maintenance')` block at the end of the test file:

```typescript
describe('maintenance', () => {
  it('getDiskUsage returns total bytes in sessions directory', async () => {
    await engine.createSession(makeEntry());
    const transcriptPath = engine.resolveTranscriptPath(makeEntry());
    await fs.writeFile(transcriptPath, 'x'.repeat(1000), 'utf-8');

    const usage = await engine.getDiskUsage();
    expect(usage).toBeGreaterThan(1000);
  });

  it('getDiskUsage returns 0 for empty directory', async () => {
    const usage = await engine.getDiskUsage();
    expect(usage).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/runtime/storage-engine.test.ts`
Expected: FAIL — `engine.getDiskUsage is not a function`

- [ ] **Step 4: Implement getDiskUsage**

In `server/runtime/storage-engine.ts`, add after the `enforceRetention` method:

```typescript
async getDiskUsage(): Promise<number> {
  try {
    const entries = await fs.readdir(this.sessionsDir);
    let total = 0;
    for (const entry of entries) {
      try {
        const stat = await fs.stat(path.join(this.sessionsDir, entry));
        if (stat.isFile()) {
          total += stat.size;
        }
      } catch {
        // Skip inaccessible files
      }
    }
    return total;
  } catch {
    return 0;
  }
}
```

- [ ] **Step 5: Run getDiskUsage tests to verify they pass**

Run: `npx vitest run server/runtime/storage-engine.test.ts`
Expected: PASS for getDiskUsage tests

- [ ] **Step 6: Write failing tests for pruneStaleEntries**

Add to the `maintenance` describe block:

```typescript
it('pruneStaleEntries removes entries older than threshold (enforce)', async () => {
  const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const recentDate = new Date().toISOString();

  await engine.createSession(makeEntry({
    sessionKey: 'agent:test-agent:old',
    sessionId: 'old-1',
    updatedAt: oldDate,
  }));
  await engine.createSession(makeEntry({
    sessionKey: 'agent:test-agent:recent',
    sessionId: 'recent-1',
    updatedAt: recentDate,
  }));

  const pruned = await engine.pruneStaleEntries(30, false);
  expect(pruned).toEqual(['agent:test-agent:old']);

  const remaining = await engine.listSessions();
  expect(remaining).toHaveLength(1);
  expect(remaining[0].sessionKey).toBe('agent:test-agent:recent');
});

it('pruneStaleEntries dry-run does not delete', async () => {
  const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await engine.createSession(makeEntry({
    sessionKey: 'agent:test-agent:old',
    sessionId: 'old-1',
    updatedAt: oldDate,
  }));

  const pruned = await engine.pruneStaleEntries(30, true);
  expect(pruned).toEqual(['agent:test-agent:old']);

  const remaining = await engine.listSessions();
  expect(remaining).toHaveLength(1);
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run server/runtime/storage-engine.test.ts`
Expected: FAIL — `engine.pruneStaleEntries is not a function`

- [ ] **Step 8: Implement pruneStaleEntries**

```typescript
async pruneStaleEntries(pruneAfterDays: number, dryRun: boolean): Promise<string[]> {
  const store = await this.readStore();
  const cutoff = Date.now() - pruneAfterDays * 24 * 60 * 60 * 1000;
  const stale: string[] = [];

  for (const [key, entry] of Object.entries(store)) {
    const updated = new Date(entry.updatedAt).getTime();
    if (!Number.isNaN(updated) && updated < cutoff) {
      stale.push(key);
    }
  }

  if (!dryRun) {
    for (const key of stale) {
      await this.deleteSession(key);
    }
  }

  return stale;
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run server/runtime/storage-engine.test.ts`
Expected: PASS

- [ ] **Step 10: Write failing tests for removeOrphanTranscripts**

```typescript
it('removeOrphanTranscripts deletes unreferenced jsonl files (enforce)', async () => {
  await engine.createSession(makeEntry({ sessionId: 'valid-1', sessionFile: 'sessions/valid-1.jsonl' }));
  const validPath = path.join(config.storagePath, 'test-agent', 'sessions', 'valid-1.jsonl');
  const orphanPath = path.join(config.storagePath, 'test-agent', 'sessions', 'orphan-1.jsonl');
  await fs.writeFile(validPath, 'valid\n', 'utf-8');
  await fs.writeFile(orphanPath, 'orphan\n', 'utf-8');

  const removed = await engine.removeOrphanTranscripts(false);
  expect(removed).toEqual(['orphan-1.jsonl']);
  await expect(fs.stat(orphanPath)).rejects.toThrow();
  await expect(fs.stat(validPath)).resolves.toBeDefined();
});

it('removeOrphanTranscripts dry-run does not delete', async () => {
  const orphanPath = path.join(config.storagePath, 'test-agent', 'sessions', 'orphan-1.jsonl');
  await fs.writeFile(orphanPath, 'orphan\n', 'utf-8');

  const removed = await engine.removeOrphanTranscripts(true);
  expect(removed).toEqual(['orphan-1.jsonl']);
  await expect(fs.stat(orphanPath)).resolves.toBeDefined();
});
```

- [ ] **Step 11: Implement removeOrphanTranscripts**

```typescript
async removeOrphanTranscripts(dryRun: boolean): Promise<string[]> {
  const store = await this.readStore();
  const referenced = new Set<string>();
  for (const entry of Object.values(store)) {
    const transcriptPath = this.resolveTranscriptPath(entry);
    referenced.add(path.basename(transcriptPath));
  }

  const orphans: string[] = [];
  try {
    const files = await fs.readdir(this.sessionsDir);
    for (const file of files) {
      if (file.endsWith('.jsonl') && !referenced.has(file)) {
        orphans.push(file);
        if (!dryRun) {
          await fs.unlink(path.join(this.sessionsDir, file)).catch(() => {});
        }
      }
    }
  } catch {
    // Directory may not exist
  }

  return orphans;
}
```

- [ ] **Step 12: Write failing tests for cleanResetArchives**

```typescript
it('cleanResetArchives removes old reset archives (enforce)', async () => {
  const oldArchive = path.join(config.storagePath, 'test-agent', 'sessions', 'sess-1.reset.2026-03-01T00-00-00.jsonl');
  const recentArchive = path.join(config.storagePath, 'test-agent', 'sessions', `sess-2.reset.${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  await fs.writeFile(oldArchive, 'old\n', 'utf-8');
  await fs.writeFile(recentArchive, 'recent\n', 'utf-8');

  // Set old archive's mtime to 40 days ago
  const oldTime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  await fs.utimes(oldArchive, oldTime, oldTime);

  const removed = await engine.cleanResetArchives(30, false);
  expect(removed).toHaveLength(1);
  expect(removed[0]).toContain('sess-1.reset');
  await expect(fs.stat(oldArchive)).rejects.toThrow();
  await expect(fs.stat(recentArchive)).resolves.toBeDefined();
});
```

- [ ] **Step 13: Implement cleanResetArchives**

```typescript
async cleanResetArchives(retentionDays: number, dryRun: boolean): Promise<string[]> {
  if (retentionDays <= 0) return [];

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];

  try {
    const files = await fs.readdir(this.sessionsDir);
    for (const file of files) {
      if (!file.includes('.reset.')) continue;
      try {
        const stat = await fs.stat(path.join(this.sessionsDir, file));
        if (stat.mtimeMs < cutoff) {
          removed.push(file);
          if (!dryRun) {
            await fs.unlink(path.join(this.sessionsDir, file)).catch(() => {});
          }
        }
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // Directory may not exist
  }

  return removed;
}
```

- [ ] **Step 14: Write failing tests for rotateStoreFile**

```typescript
it('rotateStoreFile archives sessions.json when oversized (enforce)', async () => {
  // Create enough data to exceed 100 bytes
  for (let i = 0; i < 10; i++) {
    await engine.createSession(makeEntry({
      sessionKey: `agent:test-agent:s${i}`,
      sessionId: `sess-${i}`,
      displayName: 'x'.repeat(50),
    }));
  }

  const rotated = await engine.rotateStoreFile(100, false);
  expect(rotated).toBe(true);

  // Verify a backup file exists
  const files = await fs.readdir(path.join(config.storagePath, 'test-agent', 'sessions'));
  const backups = files.filter(f => f.startsWith('sessions.') && f.endsWith('.json.bak'));
  expect(backups.length).toBeGreaterThanOrEqual(1);

  // Original sessions.json should be a fresh empty store
  const sessions = await engine.listSessions();
  expect(sessions).toHaveLength(0);
});

it('rotateStoreFile does nothing when under limit', async () => {
  await engine.createSession(makeEntry());
  const rotated = await engine.rotateStoreFile(10_485_760, false);
  expect(rotated).toBe(false);
});
```

- [ ] **Step 15: Implement rotateStoreFile**

```typescript
async rotateStoreFile(maxBytes: number, dryRun: boolean): Promise<boolean> {
  try {
    const stat = await fs.stat(this.storePath());
    if (stat.size <= maxBytes) return false;
  } catch {
    return false;
  }

  if (dryRun) return true;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(this.sessionsDir, `sessions.${timestamp}.json.bak`);
  await fs.rename(this.storePath(), backupPath);
  this.storeCache = null;
  await this.writeStore({});
  return true;
}
```

- [ ] **Step 16: Write failing tests for enforceDiskBudget**

```typescript
it('enforceDiskBudget evicts oldest sessions when over budget (enforce)', async () => {
  for (let i = 0; i < 5; i++) {
    const entry = makeEntry({
      sessionKey: `agent:test-agent:s${i}`,
      sessionId: `sess-${i}`,
      sessionFile: `sessions/sess-${i}.jsonl`,
      updatedAt: `2026-04-0${i + 1}T10:00:00.000Z`,
    });
    await engine.createSession(entry);
    const tPath = engine.resolveTranscriptPath(entry);
    await fs.writeFile(tPath, 'x'.repeat(1000), 'utf-8');
  }

  // Budget: 2000 bytes, highWater: 1000 bytes. With 5 files of ~1000 each + sessions.json this exceeds budget
  const evicted = await engine.enforceDiskBudget(2000, 1000, false);
  expect(evicted.length).toBeGreaterThan(0);

  const usage = await engine.getDiskUsage();
  expect(usage).toBeLessThanOrEqual(2000);
});
```

- [ ] **Step 17: Implement enforceDiskBudget**

```typescript
async enforceDiskBudget(maxBytes: number, highWaterBytes: number, dryRun: boolean): Promise<string[]> {
  if (maxBytes <= 0) return [];

  let usage = await this.getDiskUsage();
  if (usage <= maxBytes) return [];

  const evicted: string[] = [];

  // Phase 1: remove orphan transcripts
  if (!dryRun) {
    await this.removeOrphanTranscripts(false);
    usage = await this.getDiskUsage();
    if (usage <= highWaterBytes) return evicted;
  }

  // Phase 2: evict oldest sessions until under highWaterBytes
  const sessions = await this.listSessions();
  // listSessions returns newest first, we want to evict oldest first
  const oldestFirst = [...sessions].reverse();

  for (const session of oldestFirst) {
    if (usage <= highWaterBytes) break;
    evicted.push(session.sessionKey);
    if (!dryRun) {
      const transcriptPath = this.resolveTranscriptPath(session);
      let fileSize = 0;
      try {
        const stat = await fs.stat(transcriptPath);
        fileSize = stat.size;
      } catch {
        // File may not exist
      }
      await this.deleteSession(session.sessionKey);
      usage -= fileSize;
    }
  }

  return evicted;
}
```

- [ ] **Step 18: Write failing test for runMaintenance orchestrator**

```typescript
it('runMaintenance orchestrates the full pipeline', async () => {
  const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await engine.createSession(makeEntry({
    sessionKey: 'agent:test-agent:stale',
    sessionId: 'stale-1',
    updatedAt: oldDate,
  }));

  const report = await engine.runMaintenance('warn');
  expect(report.mode).toBe('warn');
  expect(report.prunedEntries).toContain('agent:test-agent:stale');

  // Warn mode should NOT delete
  const remaining = await engine.listSessions();
  expect(remaining).toHaveLength(1);
});

it('runMaintenance enforce mode deletes', async () => {
  const oldDate = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  await engine.createSession(makeEntry({
    sessionKey: 'agent:test-agent:stale',
    sessionId: 'stale-1',
    updatedAt: oldDate,
  }));

  const report = await engine.runMaintenance('enforce');
  expect(report.mode).toBe('enforce');
  expect(report.prunedEntries).toContain('agent:test-agent:stale');

  const remaining = await engine.listSessions();
  expect(remaining).toHaveLength(0);
});
```

- [ ] **Step 19: Implement runMaintenance**

Add import for `MaintenanceReport` at the top of `storage-engine.ts`:

```typescript
import type { SessionStoreEntry, MemoryFileInfo, MaintenanceReport } from '../../shared/storage-types';
```

Then add the method:

```typescript
async runMaintenance(mode?: 'warn' | 'enforce'): Promise<MaintenanceReport> {
  const effectiveMode = mode ?? this.config.maintenanceMode;
  const dryRun = effectiveMode === 'warn';
  const diskBefore = await this.getDiskUsage();

  const prunedEntries = await this.pruneStaleEntries(this.config.pruneAfterDays, dryRun);
  const orphanTranscripts = await this.removeOrphanTranscripts(dryRun);
  const archivedResets = await this.cleanResetArchives(this.config.resetArchiveRetentionDays, dryRun);

  // Enforce maxEntries
  if (!dryRun) {
    const sessions = await this.listSessions();
    if (sessions.length > this.config.maxEntries) {
      const overflow = sessions.slice(this.config.maxEntries);
      for (const session of overflow) {
        prunedEntries.push(session.sessionKey);
        await this.deleteSession(session.sessionKey);
      }
    }
  }

  const storeRotated = await this.rotateStoreFile(this.config.rotateBytes, dryRun);

  const highWaterBytes = Math.floor(this.config.maxDiskBytes * this.config.highWaterPercent / 100);
  const evictedForBudget = await this.enforceDiskBudget(this.config.maxDiskBytes, highWaterBytes, dryRun);

  const diskAfter = dryRun ? diskBefore : await this.getDiskUsage();

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
```

Also expose `storeCache` reset for `rotateStoreFile` — change the private field declaration to allow clearing:

The `storeCache` field already exists and `rotateStoreFile` sets it to null. We need `storePath()` to be accessible from `rotateStoreFile`. It already is since it's a private method in the same class.

- [ ] **Step 20: Run all maintenance tests**

Run: `npx vitest run server/runtime/storage-engine.test.ts`
Expected: All tests PASS

- [ ] **Step 21: Commit**

```bash
git add server/runtime/storage-engine.ts server/runtime/storage-engine.test.ts
git commit -m "feat: add maintenance methods to StorageEngine (TDD)"
```

---

### Task 3: MaintenanceScheduler + REST endpoints + client

**Files:**
- Create: `server/runtime/maintenance-scheduler.ts`
- Create: `server/runtime/maintenance-scheduler.test.ts`
- Modify: `server/index.ts`
- Modify: `src/runtime/storage-client.ts`

- [ ] **Step 1: Write failing test for MaintenanceScheduler**

Create `server/runtime/maintenance-scheduler.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { MaintenanceScheduler } from './maintenance-scheduler';
import type { StorageEngine } from './storage-engine';
import type { MaintenanceReport } from '../../shared/storage-types';

function makeMockEngine(): StorageEngine {
  const mockReport: MaintenanceReport = {
    mode: 'warn',
    prunedEntries: [],
    orphanTranscripts: [],
    archivedResets: [],
    storeRotated: false,
    diskBefore: 0,
    diskAfter: 0,
    evictedForBudget: [],
  };

  return {
    runMaintenance: vi.fn().mockResolvedValue(mockReport),
  } as unknown as StorageEngine;
}

describe('MaintenanceScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs maintenance on start', async () => {
    const engine = makeMockEngine();
    const scheduler = new MaintenanceScheduler(engine, 60);
    scheduler.start();

    // Flush the startup run
    await vi.advanceTimersByTimeAsync(0);
    expect(engine.runMaintenance).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it('runs maintenance on interval', async () => {
    const engine = makeMockEngine();
    const scheduler = new MaintenanceScheduler(engine, 1); // 1 minute
    scheduler.start();

    await vi.advanceTimersByTimeAsync(0); // startup run
    await vi.advanceTimersByTimeAsync(60_000); // 1 minute
    expect(engine.runMaintenance).toHaveBeenCalledTimes(2);

    scheduler.stop();
  });

  it('runNow triggers on-demand maintenance', async () => {
    const engine = makeMockEngine();
    const scheduler = new MaintenanceScheduler(engine, 60);

    const report = await scheduler.runNow();
    expect(report.mode).toBe('warn');
    expect(engine.runMaintenance).toHaveBeenCalledTimes(1);
  });

  it('stop clears the interval', async () => {
    const engine = makeMockEngine();
    const scheduler = new MaintenanceScheduler(engine, 1);
    scheduler.start();

    await vi.advanceTimersByTimeAsync(0); // startup
    scheduler.stop();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(engine.runMaintenance).toHaveBeenCalledTimes(1); // only the startup
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/runtime/maintenance-scheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement MaintenanceScheduler**

Create `server/runtime/maintenance-scheduler.ts`:

```typescript
import type { StorageEngine } from './storage-engine';
import type { MaintenanceReport } from '../../shared/storage-types';

export class MaintenanceScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly engine: StorageEngine,
    private readonly intervalMinutes: number,
  ) {}

  start(): void {
    this.stop();
    // Run once at startup
    void this.engine.runMaintenance().catch((err) => {
      console.error('[MaintenanceScheduler] startup run failed:', err);
    });

    this.timer = setInterval(() => {
      void this.engine.runMaintenance().catch((err) => {
        console.error('[MaintenanceScheduler] scheduled run failed:', err);
      });
    }, this.intervalMinutes * 60 * 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runNow(mode?: 'warn' | 'enforce'): Promise<MaintenanceReport> {
    return this.engine.runMaintenance(mode);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/runtime/maintenance-scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Add REST endpoints to server/index.ts**

Add before the health check route in `server/index.ts`:

```typescript
app.post('/api/storage/maintenance', async (req, res) => {
  const { config, agentName } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    const report = await engine.runMaintenance();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/storage/maintenance/dry-run', async (req, res) => {
  const { config, agentName } = req.body as {
    config: ResolvedStorageConfig;
    agentName: string;
  };
  try {
    const engine = getOrCreateEngine(config, agentName);
    const report = await engine.runMaintenance('warn');
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 6: Add client methods to StorageClient**

Add to `src/runtime/storage-client.ts` before the closing brace of the class. Also add the import for `MaintenanceReport`:

```typescript
import type { SessionStoreEntry, MemoryFileInfo, MaintenanceReport } from '../../shared/storage-types';
```

Then the methods:

```typescript
async runMaintenance(): Promise<MaintenanceReport> {
  const res = await fetch('/api/storage/maintenance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: this.config, agentName: this.agentName }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async runMaintenanceDryRun(): Promise<MaintenanceReport> {
  const res = await fetch('/api/storage/maintenance/dry-run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: this.config, agentName: this.agentName }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

- [ ] **Step 7: Commit**

```bash
git add server/runtime/maintenance-scheduler.ts server/runtime/maintenance-scheduler.test.ts server/index.ts src/runtime/storage-client.ts
git commit -m "feat: add MaintenanceScheduler, REST endpoints, and client methods"
```

---

### Task 4: Maintenance UI

**Files:**
- Modify: `src/panels/property-editors/StorageProperties.tsx`
- Modify: `src/settings/sections/DataMaintenanceSection.tsx`

- [ ] **Step 1: Add Maintenance section to StorageProperties.tsx**

Add after the Session Resets closing `</div>` (line 153), before the final `</div>`:

```tsx
      <div className="mt-3 border-t border-slate-800/80 pt-3">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Maintenance
        </div>

        <Field label="Mode">
          <select
            className={selectClass}
            value={data.maintenanceMode}
            onChange={(e) =>
              update(nodeId, { maintenanceMode: e.target.value as 'warn' | 'enforce' })
            }
          >
            <option value="warn">Warn (dry run)</option>
            <option value="enforce">Enforce (auto cleanup)</option>
          </select>
        </Field>

        <Field label="Prune After (days)">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={data.pruneAfterDays}
            onChange={(e) =>
              update(nodeId, { pruneAfterDays: parseInt(e.target.value, 10) || 30 })
            }
          />
        </Field>

        <Field label="Max Entries">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={data.maxEntries}
            onChange={(e) =>
              update(nodeId, { maxEntries: parseInt(e.target.value, 10) || 500 })
            }
          />
        </Field>

        <Field label="Rotate Store (bytes)">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={data.rotateBytes}
            onChange={(e) =>
              update(nodeId, { rotateBytes: parseInt(e.target.value, 10) || 10_485_760 })
            }
          />
        </Field>

        <Field label="Archive Retention (days)">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={data.resetArchiveRetentionDays}
            onChange={(e) =>
              update(nodeId, { resetArchiveRetentionDays: parseInt(e.target.value, 10) || 30 })
            }
          />
        </Field>

        <Field label="Max Disk (bytes, 0=disabled)">
          <input
            className={inputClass}
            type="number"
            min={0}
            value={data.maxDiskBytes}
            onChange={(e) =>
              update(nodeId, { maxDiskBytes: parseInt(e.target.value, 10) || 0 })
            }
          />
        </Field>

        {data.maxDiskBytes > 0 && (
          <Field label="High Water (%)">
            <input
              className={inputClass}
              type="number"
              min={1}
              max={100}
              value={data.highWaterPercent}
              onChange={(e) =>
                update(nodeId, {
                  highWaterPercent: Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 80)),
                })
              }
            />
          </Field>
        )}

        <Field label="Interval (minutes)">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={data.maintenanceIntervalMinutes}
            onChange={(e) =>
              update(nodeId, { maintenanceIntervalMinutes: parseInt(e.target.value, 10) || 60 })
            }
          />
        </Field>
      </div>
```

- [ ] **Step 2: Add Run Maintenance button to DataMaintenanceSection.tsx**

Add import for `MaintenanceReport`:

```typescript
import type { MaintenanceReport } from '../../shared/storage-types';
```

Add a state variable after `message`:

```typescript
const [maintenanceReport, setMaintenanceReport] = useState<MaintenanceReport | null>(null);
```

Add a `runMaintenance` handler after `clearPersistedSessions`:

```typescript
const runMaintenance = async () => {
  setMaintenanceReport(null);
  const agentNodes = nodes.filter((node) => node.data.type === 'agent');
  for (const node of agentNodes) {
    const agentName = (node.data as { name?: string }).name;
    if (!agentName) continue;

    const config = resolveAgentConfig(node.id, nodes, edges);
    if (!config?.storage) continue;

    const client = new StorageClient(config.storage, agentName, node.id);
    const report = await client.runMaintenance();
    setMaintenanceReport(report);
  }
};
```

Add the button and report display after the "Clear Chat Sessions" button inside the destructive grid:

```tsx
<button
  type="button"
  onClick={() => void runMaintenance()}
  className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-900/60 sm:col-span-2"
>
  Run Maintenance
</button>
```

Add the report display after the destructive grid `</div>`:

```tsx
{maintenanceReport && (
  <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4 text-xs text-slate-300 space-y-1">
    <div>Mode: {maintenanceReport.mode}</div>
    <div>Pruned entries: {maintenanceReport.prunedEntries.length}</div>
    <div>Orphan transcripts: {maintenanceReport.orphanTranscripts.length}</div>
    <div>Archived resets: {maintenanceReport.archivedResets.length}</div>
    <div>Store rotated: {maintenanceReport.storeRotated ? 'yes' : 'no'}</div>
    <div>Disk budget evictions: {maintenanceReport.evictedForBudget.length}</div>
    <div>Disk: {maintenanceReport.diskBefore} → {maintenanceReport.diskAfter} bytes</div>
  </div>
)}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/panels/property-editors/StorageProperties.tsx src/settings/sections/DataMaintenanceSection.tsx
git commit -m "feat: add maintenance UI to StorageProperties and DataMaintenance"
```

---

### Task 5: SubAgentRegistry (TDD)

**Files:**
- Create: `server/runtime/sub-agent-registry.ts`
- Create: `server/runtime/sub-agent-registry.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/runtime/sub-agent-registry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { SubAgentRegistry } from './sub-agent-registry';

describe('SubAgentRegistry', () => {
  it('spawn registers a sub-agent and listForParent returns it', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
    );

    expect(record.subAgentId).toBeDefined();
    expect(record.status).toBe('running');

    const list = registry.listForParent('agent:a1:main');
    expect(list).toHaveLength(1);
    expect(list[0].sessionKey).toBe('sub:agent:a1:main:abc');
  });

  it('onComplete updates status and stores result', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
    );

    registry.onComplete(record.runId, 'Task done');

    const updated = registry.get(record.subAgentId);
    expect(updated?.status).toBe('completed');
    expect(updated?.result).toBe('Task done');
    expect(updated?.endedAt).toBeDefined();
  });

  it('onError updates status and stores error', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
    );

    registry.onError(record.runId, 'Something broke');

    const updated = registry.get(record.subAgentId);
    expect(updated?.status).toBe('error');
    expect(updated?.error).toBe('Something broke');
  });

  it('kill marks sub-agent as killed', () => {
    const registry = new SubAgentRegistry();
    const record = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
    );

    const killed = registry.kill(record.subAgentId);
    expect(killed).toBe(true);

    const updated = registry.get(record.subAgentId);
    expect(updated?.status).toBe('error');
    expect(updated?.error).toBe('Killed by parent');
  });

  it('yield pending flag lifecycle', () => {
    const registry = new SubAgentRegistry();
    expect(registry.isYieldPending('agent:a1:main')).toBe(false);

    registry.setYieldPending('agent:a1:main');
    expect(registry.isYieldPending('agent:a1:main')).toBe(true);

    registry.clearYieldPending('agent:a1:main');
    expect(registry.isYieldPending('agent:a1:main')).toBe(false);
  });

  it('allComplete returns true when all sub-agents for parent are done', () => {
    const registry = new SubAgentRegistry();
    const r1 = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:abc', runId: 'run-2' },
    );
    const r2 = registry.spawn(
      { sessionKey: 'agent:a1:main', runId: 'run-1' },
      { agentId: 'a1', sessionKey: 'sub:agent:a1:main:def', runId: 'run-3' },
    );

    expect(registry.allComplete('agent:a1:main')).toBe(false);

    registry.onComplete(r1.runId, 'done 1');
    expect(registry.allComplete('agent:a1:main')).toBe(false);

    registry.onComplete(r2.runId, 'done 2');
    expect(registry.allComplete('agent:a1:main')).toBe(true);
  });

  it('get returns null for unknown subAgentId', () => {
    const registry = new SubAgentRegistry();
    expect(registry.get('nonexistent')).toBeNull();
  });

  it('kill returns false for unknown subAgentId', () => {
    const registry = new SubAgentRegistry();
    expect(registry.kill('nonexistent')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/runtime/sub-agent-registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SubAgentRegistry**

Create `server/runtime/sub-agent-registry.ts`:

```typescript
import { randomUUID } from 'crypto';

export interface SubAgentRecord {
  subAgentId: string;
  parentSessionKey: string;
  parentRunId: string;
  targetAgentId: string;
  sessionKey: string;
  runId: string;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  endedAt?: number;
  result?: string;
  error?: string;
}

export class SubAgentRegistry {
  private readonly records = new Map<string, SubAgentRecord>();
  private readonly byRunId = new Map<string, string>();
  private readonly yieldPending = new Set<string>();

  spawn(
    parent: { sessionKey: string; runId: string },
    target: { agentId: string; sessionKey: string; runId: string },
  ): SubAgentRecord {
    const subAgentId = randomUUID();
    const record: SubAgentRecord = {
      subAgentId,
      parentSessionKey: parent.sessionKey,
      parentRunId: parent.runId,
      targetAgentId: target.agentId,
      sessionKey: target.sessionKey,
      runId: target.runId,
      status: 'running',
      startedAt: Date.now(),
    };

    this.records.set(subAgentId, record);
    this.byRunId.set(target.runId, subAgentId);
    return record;
  }

  onComplete(runId: string, result: string): void {
    const subAgentId = this.byRunId.get(runId);
    if (!subAgentId) return;
    const record = this.records.get(subAgentId);
    if (!record || record.status !== 'running') return;

    record.status = 'completed';
    record.result = result;
    record.endedAt = Date.now();
  }

  onError(runId: string, error: string): void {
    const subAgentId = this.byRunId.get(runId);
    if (!subAgentId) return;
    const record = this.records.get(subAgentId);
    if (!record || record.status !== 'running') return;

    record.status = 'error';
    record.error = error;
    record.endedAt = Date.now();
  }

  listForParent(parentSessionKey: string): SubAgentRecord[] {
    return [...this.records.values()].filter(
      (r) => r.parentSessionKey === parentSessionKey,
    );
  }

  get(subAgentId: string): SubAgentRecord | null {
    return this.records.get(subAgentId) ?? null;
  }

  kill(subAgentId: string): boolean {
    const record = this.records.get(subAgentId);
    if (!record || record.status !== 'running') return false;

    record.status = 'error';
    record.error = 'Killed by parent';
    record.endedAt = Date.now();
    return true;
  }

  allComplete(parentSessionKey: string): boolean {
    const children = this.listForParent(parentSessionKey);
    return children.length > 0 && children.every((r) => r.status !== 'running');
  }

  setYieldPending(parentSessionKey: string): void {
    this.yieldPending.add(parentSessionKey);
  }

  isYieldPending(parentSessionKey: string): boolean {
    return this.yieldPending.has(parentSessionKey);
  }

  clearYieldPending(parentSessionKey: string): void {
    this.yieldPending.delete(parentSessionKey);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/runtime/sub-agent-registry.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add server/runtime/sub-agent-registry.ts server/runtime/sub-agent-registry.test.ts
git commit -m "feat: add SubAgentRegistry for sub-agent spawn tracking and yield coordination"
```

---

### Task 6: Session tools implementation + tool registration

**Files:**
- Create: `server/runtime/session-tools.ts`
- Create: `server/runtime/session-tools.test.ts`
- Modify: `server/runtime/tool-factory.ts`
- Modify: `shared/resolve-tool-names.ts`

- [ ] **Step 1: Add session tool names to shared/resolve-tool-names.ts**

In `shared/resolve-tool-names.ts`, add 7 names to `ALL_TOOL_NAMES` and a `sessions` group to `TOOL_GROUPS`:

```typescript
export const TOOL_GROUPS: Record<string, string[]> = {
  runtime: ['bash', 'code_interpreter'],
  fs: ['read_file', 'write_file', 'list_directory'],
  web: ['web_search', 'web_fetch'],
  memory: ['memory_search', 'memory_get', 'memory_save'],
  coding: ['bash', 'read_file', 'write_file', 'code_interpreter'],
  communication: ['send_message'],
  sessions: [
    'sessions_list',
    'sessions_history',
    'sessions_send',
    'sessions_spawn',
    'sessions_yield',
    'subagents',
    'session_status',
  ],
};

export const ALL_TOOL_NAMES = [
  'bash',
  'code_interpreter',
  'read_file',
  'write_file',
  'list_directory',
  'web_search',
  'web_fetch',
  'calculator',
  'memory_search',
  'memory_get',
  'memory_save',
  'send_message',
  'image_generation',
  'text_to_speech',
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_spawn',
  'sessions_yield',
  'subagents',
  'session_status',
];
```

- [ ] **Step 2: Update tool-factory.ts to skip session tools in createAgentTools**

In `server/runtime/tool-factory.ts`, update `ALL_TOOL_NAMES` to include the session tools, and update the skip list in `createAgentTools`:

Update the `ALL_TOOL_NAMES` array:

```typescript
export const ALL_TOOL_NAMES = [
  'bash',
  'code_interpreter',
  'read_file',
  'write_file',
  'list_directory',
  'web_search',
  'web_fetch',
  'calculator',
  'memory_search',
  'memory_get',
  'memory_save',
  'send_message',
  'image_generation',
  'text_to_speech',
  'sessions_list',
  'sessions_history',
  'sessions_send',
  'sessions_spawn',
  'sessions_yield',
  'subagents',
  'session_status',
];
```

Update the skip condition in `createAgentTools`:

```typescript
const SESSION_TOOL_NAMES = [
  'sessions_list', 'sessions_history', 'sessions_send',
  'sessions_spawn', 'sessions_yield', 'subagents', 'session_status',
];

export function createAgentTools(
  names: string[],
  extraTools: AgentTool<TSchema>[] = [],
): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [];

  for (const name of names) {
    // Skip memory and session tools - provided separately
    if (['memory_search', 'memory_get', 'memory_save'].includes(name)) continue;
    if (SESSION_TOOL_NAMES.includes(name)) continue;

    const creator = TOOL_CREATORS[name];
    if (creator) {
      tools.push(creator());
    }
  }

  return [...tools, ...extraTools];
}
```

- [ ] **Step 3: Write failing tests for session tools**

Create `server/runtime/session-tools.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { createSessionTools, type SessionToolContext } from './session-tools';

function makeMockContext(overrides?: Partial<SessionToolContext>): SessionToolContext {
  return {
    callerSessionKey: 'agent:a1:main',
    callerAgentId: 'a1',
    callerRunId: 'run-1',
    sessionRouter: {
      listSessions: vi.fn().mockResolvedValue([
        {
          sessionKey: 'agent:a1:main',
          agentId: 'a1',
          chatType: 'direct',
          displayName: 'Main',
          updatedAt: '2026-04-07T10:00:00Z',
          totalTokens: 5000,
          compactionCount: 1,
        },
      ]),
      getStatus: vi.fn().mockResolvedValue({
        sessionKey: 'agent:a1:main',
        sessionId: 'sess-1',
        agentId: 'a1',
        chatType: 'direct',
        createdAt: '2026-04-07T08:00:00Z',
        updatedAt: '2026-04-07T10:00:00Z',
        inputTokens: 3000,
        outputTokens: 2000,
        contextTokens: 4000,
        totalEstimatedCostUsd: 0.01,
        compactionCount: 1,
      }),
      updateAfterTurn: vi.fn().mockResolvedValue(undefined),
    } as any,
    storageEngine: {
      resolveTranscriptPath: vi.fn().mockReturnValue('/tmp/sess-1.jsonl'),
    } as any,
    transcriptStore: {
      readTranscript: vi.fn().mockReturnValue([
        { type: 'message', id: 'e1', parentId: null, timestamp: '2026-04-07T08:00:00Z', message: { role: 'user', content: 'Hello' } },
        { type: 'message', id: 'e2', parentId: 'e1', timestamp: '2026-04-07T08:01:00Z', message: { role: 'assistant', content: 'Hi there' } },
      ]),
    } as any,
    coordinator: {
      dispatch: vi.fn().mockResolvedValue({ runId: 'run-new', sessionId: 'sess-2', acceptedAt: Date.now() }),
      wait: vi.fn().mockResolvedValue({
        runId: 'run-new',
        status: 'completed',
        payloads: [{ type: 'text', content: 'Result' }],
      }),
    } as any,
    subAgentRegistry: {
      spawn: vi.fn().mockReturnValue({
        subAgentId: 'sub-1',
        sessionKey: 'sub:agent:a1:main:abc',
        runId: 'run-sub',
        status: 'running',
        startedAt: Date.now(),
      }),
      listForParent: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
      kill: vi.fn().mockReturnValue(true),
      setYieldPending: vi.fn(),
    } as any,
    coordinatorLookup: vi.fn().mockReturnValue(null),
    subAgentSpawning: true,
    ...overrides,
  };
}

describe('createSessionTools', () => {
  it('returns all 7 tools when subAgentSpawning is true', () => {
    const ctx = makeMockContext();
    const tools = createSessionTools(ctx);
    const names = tools.map((t) => t.name);
    expect(names).toContain('sessions_list');
    expect(names).toContain('sessions_history');
    expect(names).toContain('sessions_send');
    expect(names).toContain('sessions_spawn');
    expect(names).toContain('sessions_yield');
    expect(names).toContain('subagents');
    expect(names).toContain('session_status');
    expect(tools).toHaveLength(7);
  });

  it('excludes spawn/yield/subagents when subAgentSpawning is false', () => {
    const ctx = makeMockContext({ subAgentSpawning: false });
    const tools = createSessionTools(ctx);
    const names = tools.map((t) => t.name);
    expect(names).toContain('sessions_list');
    expect(names).toContain('sessions_history');
    expect(names).toContain('sessions_send');
    expect(names).toContain('session_status');
    expect(names).not.toContain('sessions_spawn');
    expect(names).not.toContain('sessions_yield');
    expect(names).not.toContain('subagents');
    expect(tools).toHaveLength(4);
  });
});

describe('sessions_list', () => {
  it('returns session summaries', async () => {
    const ctx = makeMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_list')!;
    const result = await tool.execute('call-1', {});
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('agent:a1:main');
    expect(text).toContain('Main');
  });
});

describe('sessions_history', () => {
  it('returns transcript entries', async () => {
    const ctx = makeMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_history')!;
    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:main' });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Hello');
    expect(text).toContain('Hi there');
  });
});

describe('session_status', () => {
  it('returns session metadata for caller session by default', async () => {
    const ctx = makeMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'session_status')!;
    const result = await tool.execute('call-1', {});
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('agent:a1:main');
    expect(text).toContain('3000');
  });
});

describe('sessions_send', () => {
  it('dispatches message and returns immediately when wait is false', async () => {
    const ctx = makeMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_send')!;
    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:other', message: 'Hi' });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('run-new');
    expect(ctx.coordinator.dispatch).toHaveBeenCalled();
    expect(ctx.coordinator.wait).not.toHaveBeenCalled();
  });

  it('waits for result when wait is true', async () => {
    const ctx = makeMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_send')!;
    const result = await tool.execute('call-1', { sessionKey: 'agent:a1:other', message: 'Hi', wait: true });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('Result');
    expect(ctx.coordinator.wait).toHaveBeenCalled();
  });
});

describe('sessions_spawn', () => {
  it('spawns a sub-agent and registers it', async () => {
    const ctx = makeMockContext();
    const tools = createSessionTools(ctx);
    const tool = tools.find((t) => t.name === 'sessions_spawn')!;
    const result = await tool.execute('call-1', { prompt: 'Do something' });
    const text = result.content[0].type === 'text' ? result.content[0].text : '';
    expect(text).toContain('sub-1');
    expect(ctx.subAgentRegistry.spawn).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run server/runtime/session-tools.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Implement session-tools.ts**

Create `server/runtime/session-tools.ts`:

```typescript
import { Type, type TSchema } from '@sinclair/typebox';
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import type { SessionRouter } from './session-router';
import type { StorageEngine } from './storage-engine';
import type { SessionTranscriptStore } from './session-transcript-store';
import type { SubAgentRegistry } from './sub-agent-registry';
import type { RunCoordinator } from '../agents/run-coordinator';

export interface SessionToolContext {
  callerSessionKey: string;
  callerAgentId: string;
  callerRunId: string;
  sessionRouter: SessionRouter;
  storageEngine: StorageEngine;
  transcriptStore: SessionTranscriptStore;
  coordinator: RunCoordinator;
  subAgentRegistry: SubAgentRegistry;
  coordinatorLookup: (agentId: string) => RunCoordinator | null;
  subAgentSpawning: boolean;
}

function textResult(text: string): AgentToolResult<undefined> {
  return { content: [{ type: 'text', text }], details: undefined };
}

function createSessionsListTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_list',
    description: 'List sessions with optional filters (kind, recency).',
    label: 'Sessions List',
    parameters: Type.Object({
      kind: Type.Optional(Type.Union([
        Type.Literal('all'),
        Type.Literal('agent'),
        Type.Literal('cron'),
      ])),
      recency: Type.Optional(Type.Number({ description: 'Only sessions active within this many minutes' })),
    }),
    execute: async (_id, params: any) => {
      try {
        let sessions = await ctx.sessionRouter.listSessions();

        const kind = params.kind as string | undefined;
        if (kind === 'agent') {
          sessions = sessions.filter((s) => s.sessionKey.startsWith('agent:'));
        } else if (kind === 'cron') {
          sessions = sessions.filter((s) => s.sessionKey.startsWith('cron:'));
        }

        if (params.recency) {
          const cutoff = Date.now() - (params.recency as number) * 60 * 1000;
          sessions = sessions.filter((s) => new Date(s.updatedAt).getTime() > cutoff);
        }

        const summary = sessions.map((s) => ({
          sessionKey: s.sessionKey,
          agentId: s.agentId,
          chatType: s.chatType,
          displayName: s.displayName,
          updatedAt: s.updatedAt,
          totalTokens: s.totalTokens,
          compactionCount: s.compactionCount,
        }));

        return textResult(JSON.stringify(summary, null, 2));
      } catch (e) {
        return textResult(`Error listing sessions: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSessionsHistoryTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_history',
    description: 'Read the transcript of a specific session.',
    label: 'Sessions History',
    parameters: Type.Object({
      sessionKey: Type.String({ description: 'Session key to read' }),
      limit: Type.Optional(Type.Number({ description: 'Max entries to return (default 50)' })),
    }),
    execute: async (_id, params: any) => {
      try {
        const status = await ctx.sessionRouter.getStatus(params.sessionKey as string);
        if (!status) {
          return textResult(`Session ${params.sessionKey} not found`);
        }

        const transcriptPath = ctx.storageEngine.resolveTranscriptPath(status);
        const entries = ctx.transcriptStore.readTranscript(transcriptPath);
        const limit = (params.limit as number) || 50;

        const messages = entries
          .filter((e) => e.type === 'message')
          .slice(-limit)
          .map((e) => {
            const msg = e.message as { role?: string; content?: unknown } | undefined;
            const content = typeof msg?.content === 'string'
              ? msg.content
              : Array.isArray(msg?.content)
                ? (msg!.content as any[]).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
                : '';
            const truncated = content.length > 500 ? `${content.slice(0, 500)}...` : content;
            return `[${msg?.role ?? 'unknown'}] ${truncated}`;
          });

        return textResult(messages.join('\n\n'));
      } catch (e) {
        return textResult(`Error reading history: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSessionsSendTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_send',
    description: 'Send a message to another session and optionally wait for the response.',
    label: 'Sessions Send',
    parameters: Type.Object({
      sessionKey: Type.String({ description: 'Target session key' }),
      message: Type.String({ description: 'Message to send' }),
      wait: Type.Optional(Type.Boolean({ description: 'Wait for response (default false)' })),
      timeoutMs: Type.Optional(Type.Number({ description: 'Wait timeout in ms (default 60000)' })),
    }),
    execute: async (_id, params: any) => {
      try {
        const dispatched = await ctx.coordinator.dispatch({
          sessionKey: params.sessionKey as string,
          text: params.message as string,
        });

        if (params.wait) {
          const timeout = (params.timeoutMs as number) || 60_000;
          const result = await ctx.coordinator.wait(dispatched.runId, timeout);
          const text = result.payloads
            ?.filter((p: any) => p.type === 'text')
            .map((p: any) => p.content)
            .join('') ?? '';
          return textResult(text || `Run ${dispatched.runId} completed with status: ${result.status}`);
        }

        return textResult(`Message dispatched. runId: ${dispatched.runId}`);
      } catch (e) {
        return textResult(`Error sending message: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSessionsSpawnTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_spawn',
    description: 'Spawn an isolated sub-agent session for background work.',
    label: 'Sessions Spawn',
    parameters: Type.Object({
      prompt: Type.String({ description: 'Prompt to send to the sub-agent' }),
      targetAgentId: Type.Optional(Type.String({ description: 'Target agent ID (default: same agent)' })),
      wait: Type.Optional(Type.Boolean({ description: 'Wait for sub-agent to complete (default false)' })),
      timeoutMs: Type.Optional(Type.Number({ description: 'Wait timeout in ms (default 60000)' })),
    }),
    execute: async (_id, params: any) => {
      try {
        const targetAgentId = (params.targetAgentId as string) || ctx.callerAgentId;
        const targetCoordinator = targetAgentId === ctx.callerAgentId
          ? ctx.coordinator
          : ctx.coordinatorLookup(targetAgentId);

        if (!targetCoordinator) {
          return textResult(`Agent ${targetAgentId} not found or has no coordinator`);
        }

        const subSessionKey = `sub:${ctx.callerSessionKey}:${crypto.randomUUID()}`;

        const dispatched = await targetCoordinator.dispatch({
          sessionKey: subSessionKey,
          text: params.prompt as string,
        });

        const record = ctx.subAgentRegistry.spawn(
          { sessionKey: ctx.callerSessionKey, runId: ctx.callerRunId },
          { agentId: targetAgentId, sessionKey: subSessionKey, runId: dispatched.runId },
        );

        if (params.wait) {
          const timeout = (params.timeoutMs as number) || 60_000;
          const result = await targetCoordinator.wait(dispatched.runId, timeout);
          const text = result.payloads
            ?.filter((p: any) => p.type === 'text')
            .map((p: any) => p.content)
            .join('') ?? '';
          ctx.subAgentRegistry.onComplete(dispatched.runId, text);
          return textResult(text || `Sub-agent ${record.subAgentId} completed with status: ${result.status}`);
        }

        return textResult(JSON.stringify({
          subAgentId: record.subAgentId,
          sessionKey: subSessionKey,
          runId: dispatched.runId,
        }));
      } catch (e) {
        return textResult(`Error spawning sub-agent: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSessionsYieldTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'sessions_yield',
    description: 'End the current turn and wait for sub-agent results.',
    label: 'Sessions Yield',
    parameters: Type.Object({
      message: Type.Optional(Type.String({ description: 'Final message before yielding' })),
    }),
    execute: async (_id, params: any) => {
      ctx.subAgentRegistry.setYieldPending(ctx.callerSessionKey);
      const msg = (params.message as string) || 'Waiting for sub-agent results...';
      return textResult(msg);
    },
  };
}

function createSubagentsTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'subagents',
    description: 'List, inspect, or kill spawned sub-agents.',
    label: 'Subagents',
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal('list'),
        Type.Literal('status'),
        Type.Literal('kill'),
      ]),
      subAgentId: Type.Optional(Type.String({ description: 'Sub-agent ID (required for status/kill)' })),
    }),
    execute: async (_id, params: any) => {
      try {
        const action = params.action as string;

        if (action === 'list') {
          const records = ctx.subAgentRegistry.listForParent(ctx.callerSessionKey);
          const summary = records.map((r) => ({
            subAgentId: r.subAgentId,
            sessionKey: r.sessionKey,
            status: r.status,
            startedAt: new Date(r.startedAt).toISOString(),
          }));
          return textResult(JSON.stringify(summary, null, 2));
        }

        if (!params.subAgentId) {
          return textResult('subAgentId is required for status and kill actions');
        }

        if (action === 'status') {
          const record = ctx.subAgentRegistry.get(params.subAgentId as string);
          if (!record) return textResult('Sub-agent not found');
          return textResult(JSON.stringify(record, null, 2));
        }

        if (action === 'kill') {
          const killed = ctx.subAgentRegistry.kill(params.subAgentId as string);
          return textResult(killed ? 'Sub-agent killed' : 'Sub-agent not found or already completed');
        }

        return textResult(`Unknown action: ${action}`);
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

function createSessionStatusTool(ctx: SessionToolContext): AgentTool<TSchema> {
  return {
    name: 'session_status',
    description: 'Show session status and optionally set a model override.',
    label: 'Session Status',
    parameters: Type.Object({
      sessionKey: Type.Optional(Type.String({ description: 'Session key (default: current session)' })),
      modelOverride: Type.Optional(Type.String({ description: 'Set a model override for the session' })),
    }),
    execute: async (_id, params: any) => {
      try {
        const key = (params.sessionKey as string) || ctx.callerSessionKey;

        if (params.modelOverride) {
          await ctx.sessionRouter.updateAfterTurn(key, {
            modelOverride: params.modelOverride as string,
          });
        }

        const status = await ctx.sessionRouter.getStatus(key);
        if (!status) return textResult(`Session ${key} not found`);

        const summary = {
          sessionKey: status.sessionKey,
          sessionId: status.sessionId,
          agentId: status.agentId,
          chatType: status.chatType,
          createdAt: status.createdAt,
          updatedAt: status.updatedAt,
          inputTokens: status.inputTokens,
          outputTokens: status.outputTokens,
          contextTokens: status.contextTokens,
          totalEstimatedCostUsd: status.totalEstimatedCostUsd,
          compactionCount: status.compactionCount,
          modelOverride: status.modelOverride,
          providerOverride: status.providerOverride,
        };

        return textResult(JSON.stringify(summary, null, 2));
      } catch (e) {
        return textResult(`Error: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    },
  };
}

export function createSessionTools(ctx: SessionToolContext): AgentTool<TSchema>[] {
  const tools: AgentTool<TSchema>[] = [
    createSessionsListTool(ctx),
    createSessionsHistoryTool(ctx),
    createSessionsSendTool(ctx),
    createSessionStatusTool(ctx),
  ];

  if (ctx.subAgentSpawning) {
    tools.push(
      createSessionsSpawnTool(ctx),
      createSessionsYieldTool(ctx),
      createSubagentsTool(ctx),
    );
  }

  return tools;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run server/runtime/session-tools.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add server/runtime/session-tools.ts server/runtime/session-tools.test.ts server/runtime/tool-factory.ts shared/resolve-tool-names.ts
git commit -m "feat: implement 7 session tools with tool registration"
```

---

### Task 7: RunCoordinator session tools integration

**Files:**
- Modify: `server/agents/run-coordinator.ts`

- [ ] **Step 1: Add SubAgentRegistry import and field**

At the top of `server/agents/run-coordinator.ts`, add imports:

```typescript
import { SubAgentRegistry } from '../runtime/sub-agent-registry';
import { createSessionTools, type SessionToolContext } from '../runtime/session-tools';
```

Add the field to `RunCoordinator`:

```typescript
private readonly subAgentRegistry: SubAgentRegistry;
```

In the constructor, after `this.sessionRouter = ...`, add:

```typescript
this.subAgentRegistry = new SubAgentRegistry();
```

- [ ] **Step 2: Inject session tools in executeRun**

In the `executeRun` method, after the line `this.runtime.setActiveSession(transcriptManager);` (around line 408), add session tool injection:

```typescript
// Inject session tools if storage is available
if (this.storage && this.sessionRouter && this.transcriptStore) {
  const sessionToolCtx: SessionToolContext = {
    callerSessionKey: record.sessionKey,
    callerAgentId: this.agentId,
    callerRunId: record.runId,
    sessionRouter: this.sessionRouter,
    storageEngine: this.storage,
    transcriptStore: this.transcriptStore,
    coordinator: this,
    subAgentRegistry: this.subAgentRegistry,
    coordinatorLookup: () => null, // Cross-agent lookup wired at server level later
    subAgentSpawning: this.config.tools?.subAgentSpawning ?? false,
  };
  const sessionTools = createSessionTools(sessionToolCtx);
  this.runtime.addTools(sessionTools);
}
```

- [ ] **Step 3: Handle sub-agent completion in finalizeRunSuccess**

In the method that finalizes successful runs, after notifying waiters, add:

```typescript
// Notify SubAgentRegistry if this was a sub-agent run
if (record.sessionKey.startsWith('sub:')) {
  const assistantText = record.payloads
    .filter((p) => p.type === 'text')
    .map((p) => p.content)
    .join('');
  this.subAgentRegistry.onComplete(record.runId, assistantText);
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors. If `addTools` doesn't exist on the runtime, we need to pass session tools via `extraTools` parameter in `createAgentTools`. Adapt based on how the runtime accepts tools.

- [ ] **Step 5: Commit**

```bash
git add server/agents/run-coordinator.ts
git commit -m "feat: integrate session tools and SubAgentRegistry into RunCoordinator"
```

---

### Task 8: Cron node types, config resolution, and SessionRouter extension

**Files:**
- Modify: `src/types/nodes.ts`
- Modify: `shared/agent-config.ts`
- Modify: `src/utils/default-nodes.ts`
- Modify: `src/utils/graph-to-agent.ts`
- Modify: `src/utils/theme.ts`
- Modify: `server/runtime/session-router.ts`
- Modify: `shared/session-routes.ts`

- [ ] **Step 1: Add CronNodeData to types/nodes.ts**

Add after `VectorDatabaseNodeData` and before the union types:

```typescript
// --- Cron Node ---

export interface CronNodeData {
  [key: string]: unknown;
  type: 'cron';
  label: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  sessionMode: 'persistent' | 'ephemeral';
  timezone: string;
  maxRunDurationMs: number;
  retentionDays: number;
}
```

Update `NodeType`:

```typescript
export type NodeType =
  | 'agent'
  | 'memory'
  | 'tools'
  | 'skills'
  | 'contextEngine'
  | 'agentComm'
  | 'connectors'
  | 'storage'
  | 'vectorDatabase'
  | 'cron';
```

Update `FlowNodeData`:

```typescript
export type FlowNodeData =
  | AgentNodeData
  | MemoryNodeData
  | ToolsNodeData
  | SkillsNodeData
  | ContextEngineNodeData
  | AgentCommNodeData
  | ConnectorsNodeData
  | StorageNodeData
  | VectorDatabaseNodeData
  | CronNodeData;
```

- [ ] **Step 2: Add ResolvedCronConfig to shared/agent-config.ts**

Add before `AgentConfig`:

```typescript
export interface ResolvedCronConfig {
  cronNodeId: string;
  label: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  sessionMode: 'persistent' | 'ephemeral';
  timezone: string;
  maxRunDurationMs: number;
  retentionDays: number;
}
```

Add `crons` to `AgentConfig`:

```typescript
export interface AgentConfig {
  // ... existing fields ...
  vectorDatabases: ResolvedVectorDatabaseConfig[];
  crons: ResolvedCronConfig[];
  // ... rest ...
}
```

- [ ] **Step 3: Add cron defaults to default-nodes.ts**

Add a new case before the closing of the switch:

```typescript
    case 'cron':
      return {
        type: 'cron',
        label: 'Cron Job',
        schedule: '0 9 * * *',
        prompt: '',
        enabled: true,
        sessionMode: 'persistent',
        timezone: 'local',
        maxRunDurationMs: 300000,
        retentionDays: 7,
      };
```

- [ ] **Step 4: Add cron to theme.ts**

```typescript
export const NODE_COLORS: Record<NodeType, string> = {
  agent: '#3b82f6',
  memory: '#22c55e',
  tools: '#f97316',
  skills: '#a855f7',
  contextEngine: '#06b6d4',
  agentComm: '#ec4899',
  connectors: '#eab308',
  storage: '#ef4444',
  vectorDatabase: '#14b8a6',
  cron: '#8b5cf6',
};

export const NODE_LABELS: Record<NodeType, string> = {
  agent: 'Agent',
  memory: 'Memory',
  tools: 'Tools',
  skills: 'Skills',
  contextEngine: 'Context Engine',
  agentComm: 'Agent Comm',
  connectors: 'Connectors',
  storage: 'Storage',
  vectorDatabase: 'Vector DB',
  cron: 'Cron',
};
```

- [ ] **Step 5: Resolve cron nodes in graph-to-agent.ts**

Add after the vector databases block (before `// --- Build structured system prompt ---`):

```typescript
  // --- Cron Jobs ---
  const crons = connectedNodes
    .filter((n) => n.data.type === 'cron')
    .map((n) => {
      if (n.data.type !== 'cron') throw new Error('unreachable');
      return {
        cronNodeId: n.id,
        label: n.data.label,
        schedule: n.data.schedule,
        prompt: n.data.prompt,
        enabled: n.data.enabled,
        sessionMode: n.data.sessionMode,
        timezone: n.data.timezone,
        maxRunDurationMs: n.data.maxRunDurationMs,
        retentionDays: n.data.retentionDays,
      };
    });
```

Add `crons` to the returned `AgentConfig`:

```typescript
  return {
    // ... existing fields ...
    vectorDatabases,
    crons,
    exportedAt: Date.now(),
    // ... rest ...
  };
```

- [ ] **Step 6: Extend SessionRouter for cron/webhook keys**

In `server/runtime/session-router.ts`, update `RouteRequest`:

```typescript
export interface RouteRequest {
  agentId: string;
  subKey?: string;
  chatType?: SessionStoreEntry['chatType'];
  provider?: string;
  subject?: string;
  room?: string;
  space?: string;
  displayName?: string;
  cronJobId?: string;
  webhookId?: string;
}
```

Update `buildSessionKey`:

```typescript
private buildSessionKey(agentId: string, subKey?: string, cronJobId?: string, webhookId?: string): string {
  if (cronJobId) return `cron:${cronJobId}`;
  if (webhookId) return `hook:${webhookId}`;
  return `agent:${agentId}:${subKey ?? 'main'}`;
}
```

Update the `route` method to pass through the new fields:

```typescript
async route(req: RouteRequest): Promise<RouteResult> {
  const sessionKey = this.buildSessionKey(req.agentId, req.subKey, req.cronJobId, req.webhookId);
  // ... rest unchanged ...
}
```

- [ ] **Step 7: Update shared/session-routes.ts**

Add optional fields to `SessionRouteRequest`:

```typescript
export interface SessionRouteRequest {
  subKey?: string;
  chatType?: SessionStoreEntry['chatType'];
  provider?: string;
  subject?: string;
  room?: string;
  space?: string;
  displayName?: string;
  cronJobId?: string;
  webhookId?: string;
}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/types/nodes.ts shared/agent-config.ts src/utils/default-nodes.ts src/utils/graph-to-agent.ts src/utils/theme.ts server/runtime/session-router.ts shared/session-routes.ts
git commit -m "feat: add CronNodeData type, config resolution, and SessionRouter cron/webhook keys"
```

---

### Task 9: CronScheduler + WebhookHandler + server wiring

**Files:**
- Create: `server/runtime/cron-scheduler.ts`
- Create: `server/runtime/cron-scheduler.test.ts`
- Create: `server/runtime/webhook-handler.ts`
- Modify: `package.json`

- [ ] **Step 1: Install node-cron**

```bash
npm install node-cron && npm install -D @types/node-cron
```

- [ ] **Step 2: Write failing test for CronScheduler**

Create `server/runtime/cron-scheduler.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CronScheduler } from './cron-scheduler';
import type { ResolvedCronConfig } from '../../shared/agent-config';
import type { RunCoordinator } from '../agents/run-coordinator';

function makeCronConfig(overrides?: Partial<ResolvedCronConfig>): ResolvedCronConfig {
  return {
    cronNodeId: 'cron-1',
    label: 'Test Cron',
    schedule: '* * * * *',
    prompt: 'Do the thing',
    enabled: true,
    sessionMode: 'persistent',
    timezone: 'local',
    maxRunDurationMs: 300000,
    retentionDays: 7,
    ...overrides,
  };
}

function makeMockCoordinator(): RunCoordinator {
  return {
    dispatch: vi.fn().mockResolvedValue({ runId: 'run-1', sessionId: 'sess-1', acceptedAt: Date.now() }),
    abort: vi.fn(),
  } as unknown as RunCoordinator;
}

describe('CronScheduler', () => {
  it('reconcile starts enabled jobs and stops removed ones', () => {
    const coordinator = makeMockCoordinator();
    const scheduler = new CronScheduler((id) => id === 'a1' ? coordinator : null);

    scheduler.reconcile('a1', [makeCronConfig()]);
    const jobs = scheduler.listJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].cronNodeId).toBe('cron-1');
    expect(jobs[0].status).toBe('scheduled');

    // Remove the job
    scheduler.reconcile('a1', []);
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  it('reconcile skips disabled jobs', () => {
    const coordinator = makeMockCoordinator();
    const scheduler = new CronScheduler(() => coordinator);

    scheduler.reconcile('a1', [makeCronConfig({ enabled: false })]);
    expect(scheduler.listJobs()).toHaveLength(0);
  });

  it('stopAll clears all jobs', () => {
    const coordinator = makeMockCoordinator();
    const scheduler = new CronScheduler(() => coordinator);

    scheduler.reconcile('a1', [makeCronConfig()]);
    scheduler.reconcile('a2', [makeCronConfig({ cronNodeId: 'cron-2' })]);
    expect(scheduler.listJobs()).toHaveLength(2);

    scheduler.stopAll();
    expect(scheduler.listJobs()).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run server/runtime/cron-scheduler.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement CronScheduler**

Create `server/runtime/cron-scheduler.ts`:

```typescript
import cron from 'node-cron';
import type { ResolvedCronConfig } from '../../shared/agent-config';
import type { RunCoordinator } from '../agents/run-coordinator';

export interface CronJobStatus {
  cronNodeId: string;
  agentId: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  status: 'scheduled' | 'running' | 'stopped';
}

interface ActiveJob {
  cronNodeId: string;
  agentId: string;
  config: ResolvedCronConfig;
  task: cron.ScheduledTask;
  lastRunAt?: string;
}

export class CronScheduler {
  private readonly jobs = new Map<string, ActiveJob>();

  constructor(
    private readonly coordinatorLookup: (agentId: string) => RunCoordinator | null,
  ) {}

  reconcile(agentId: string, crons: ResolvedCronConfig[]): void {
    const desiredIds = new Set(crons.filter((c) => c.enabled).map((c) => c.cronNodeId));

    // Stop removed or disabled jobs for this agent
    for (const [key, job] of this.jobs) {
      if (job.agentId === agentId && !desiredIds.has(job.cronNodeId)) {
        job.task.stop();
        this.jobs.delete(key);
      }
    }

    // Start or update jobs
    for (const config of crons) {
      if (!config.enabled) continue;

      const key = `${agentId}:${config.cronNodeId}`;
      const existing = this.jobs.get(key);

      if (existing && existing.config.schedule === config.schedule && existing.config.prompt === config.prompt) {
        existing.config = config;
        continue;
      }

      // Stop old if schedule changed
      if (existing) {
        existing.task.stop();
      }

      const task = cron.schedule(config.schedule, () => {
        void this.executeCronTick(agentId, config, key);
      }, {
        timezone: config.timezone === 'local' ? undefined : config.timezone,
      });

      this.jobs.set(key, {
        cronNodeId: config.cronNodeId,
        agentId,
        config,
        task,
      });
    }
  }

  stopAll(): void {
    for (const job of this.jobs.values()) {
      job.task.stop();
    }
    this.jobs.clear();
  }

  listJobs(): CronJobStatus[] {
    return [...this.jobs.values()].map((job) => ({
      cronNodeId: job.cronNodeId,
      agentId: job.agentId,
      schedule: job.config.schedule,
      enabled: job.config.enabled,
      lastRunAt: job.lastRunAt,
      status: 'scheduled' as const,
    }));
  }

  private async executeCronTick(agentId: string, config: ResolvedCronConfig, jobKey: string): Promise<void> {
    const coordinator = this.coordinatorLookup(agentId);
    if (!coordinator) {
      console.error(`[CronScheduler] No coordinator for agent ${agentId}`);
      return;
    }

    try {
      const dispatched = await coordinator.dispatch({
        sessionKey: `cron:${config.cronNodeId}`,
        text: config.prompt,
      });

      const job = this.jobs.get(jobKey);
      if (job) {
        job.lastRunAt = new Date().toISOString();
      }

      // Enforce max run duration
      if (config.maxRunDurationMs > 0) {
        setTimeout(() => {
          coordinator.abort(dispatched.runId);
        }, config.maxRunDurationMs);
      }
    } catch (err) {
      console.error(`[CronScheduler] Cron tick failed for ${config.cronNodeId}:`, err);
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run server/runtime/cron-scheduler.test.ts`
Expected: All PASS

- [ ] **Step 6: Implement WebhookHandler**

Create `server/runtime/webhook-handler.ts`:

```typescript
import crypto from 'crypto';
import type { Express, Request, Response } from 'express';
import type { RunCoordinator } from '../agents/run-coordinator';

export interface WebhookConfig {
  id: string;
  path: string;
  agentId: string;
  secret?: string;
  sessionKeyOverride?: string;
}

export class WebhookHandler {
  constructor(
    private readonly webhooks: WebhookConfig[],
    private readonly coordinatorLookup: (agentId: string) => RunCoordinator | null,
  ) {}

  registerRoutes(app: Express): void {
    for (const webhook of this.webhooks) {
      const routePath = `/api/webhook/${webhook.path.replace(/^\//, '')}`;

      app.post(routePath, async (req: Request, res: Response) => {
        // Validate HMAC if secret is configured
        if (webhook.secret) {
          const signature = req.headers['x-webhook-signature'] as string | undefined;
          if (!signature) {
            res.status(401).json({ error: 'Missing X-Webhook-Signature header' });
            return;
          }

          const expected = crypto
            .createHmac('sha256', webhook.secret)
            .update(JSON.stringify(req.body))
            .digest('hex');

          if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
            res.status(401).json({ error: 'Invalid signature' });
            return;
          }
        }

        const coordinator = this.coordinatorLookup(webhook.agentId);
        if (!coordinator) {
          res.status(404).json({ error: `Agent ${webhook.agentId} not found` });
          return;
        }

        // Extract message from body
        const message = typeof req.body.message === 'string'
          ? req.body.message
          : typeof req.body.text === 'string'
            ? req.body.text
            : JSON.stringify(req.body);

        const sessionKey = webhook.sessionKeyOverride ?? `hook:${webhook.id}`;

        try {
          const dispatched = await coordinator.dispatch({
            sessionKey,
            text: message,
          });

          res.status(202).json({ runId: dispatched.runId, sessionKey });
        } catch (err) {
          res.status(500).json({ error: (err as Error).message });
        }
      });
    }
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add server/runtime/cron-scheduler.ts server/runtime/cron-scheduler.test.ts server/runtime/webhook-handler.ts package.json package-lock.json
git commit -m "feat: add CronScheduler, WebhookHandler, and node-cron dependency"
```

---

### Task 10: Cron node UI

**Files:**
- Create: `src/nodes/CronNode.tsx`
- Create: `src/panels/property-editors/CronProperties.tsx`
- Modify: `src/nodes/node-registry.ts`
- Modify: `src/panels/PropertiesPanel.tsx`

- [ ] **Step 1: Create CronNode.tsx**

Create `src/nodes/CronNode.tsx`:

```tsx
import { memo } from 'react';
import { type NodeProps, type Node } from '@xyflow/react';
import { Clock } from 'lucide-react';
import BasePeripheralNode from './BasePeripheralNode';
import type { CronNodeData } from '../types/nodes';

type CronNode = Node<CronNodeData>;

function CronNodeComponent({ data, selected }: NodeProps<CronNode>) {
  return (
    <BasePeripheralNode
      nodeType="cron"
      label={data.label}
      icon={<Clock size={14} />}
      selected={selected}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${data.enabled ? 'bg-green-400' : 'bg-slate-600'}`}
        />
        <span>{data.schedule || 'No schedule'}</span>
      </div>
      <div className="truncate text-slate-500">
        {data.sessionMode === 'ephemeral' ? 'Ephemeral' : 'Persistent'}
      </div>
    </BasePeripheralNode>
  );
}

export default memo(CronNodeComponent);
```

- [ ] **Step 2: Create CronProperties.tsx**

Create `src/panels/property-editors/CronProperties.tsx`:

```tsx
import { useGraphStore } from '../../store/graph-store';
import type { CronNodeData } from '../../types/nodes';
import { Field, inputClass, selectClass } from './shared';

interface Props {
  nodeId: string;
  data: CronNodeData;
}

export default function CronProperties({ nodeId, data }: Props) {
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

      <Field label="Schedule (cron)">
        <input
          className={inputClass}
          value={data.schedule}
          onChange={(e) => update(nodeId, { schedule: e.target.value })}
          placeholder="0 9 * * *"
        />
      </Field>

      <Field label="Prompt">
        <textarea
          className={`${inputClass} min-h-[80px] resize-y`}
          value={data.prompt}
          onChange={(e) => update(nodeId, { prompt: e.target.value })}
          placeholder="Message to send on each cron tick"
        />
      </Field>

      <Field label="Enabled">
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={data.enabled}
            onChange={(e) => update(nodeId, { enabled: e.target.checked })}
          />
          Schedule is active
        </label>
      </Field>

      <Field label="Session Mode">
        <select
          className={selectClass}
          value={data.sessionMode}
          onChange={(e) =>
            update(nodeId, { sessionMode: e.target.value as 'persistent' | 'ephemeral' })
          }
        >
          <option value="persistent">Persistent (accumulate history)</option>
          <option value="ephemeral">Ephemeral (fresh each run)</option>
        </select>
      </Field>

      <Field label="Timezone">
        <input
          className={inputClass}
          value={data.timezone}
          onChange={(e) => update(nodeId, { timezone: e.target.value })}
          placeholder="local"
        />
      </Field>

      <Field label="Max Run Duration (ms)">
        <input
          className={inputClass}
          type="number"
          min={0}
          value={data.maxRunDurationMs}
          onChange={(e) =>
            update(nodeId, { maxRunDurationMs: parseInt(e.target.value, 10) || 300000 })
          }
        />
      </Field>

      {data.sessionMode === 'ephemeral' && (
        <Field label="Retention (days)">
          <input
            className={inputClass}
            type="number"
            min={1}
            value={data.retentionDays}
            onChange={(e) =>
              update(nodeId, { retentionDays: parseInt(e.target.value, 10) || 7 })
            }
          />
        </Field>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Register CronNode in node-registry.ts**

```typescript
import AgentNode from './AgentNode';
import MemoryNode from './MemoryNode';
import ToolsNode from './ToolsNode';
import SkillsNode from './SkillsNode';
import ContextEngineNode from './ContextEngineNode';
import AgentCommNode from './AgentCommNode';
import ConnectorsNode from './ConnectorsNode';
import StorageNode from './StorageNode';
import VectorDatabaseNode from './VectorDatabaseNode';
import CronNode from './CronNode';

export const nodeTypes = {
  agent: AgentNode,
  memory: MemoryNode,
  tools: ToolsNode,
  skills: SkillsNode,
  contextEngine: ContextEngineNode,
  agentComm: AgentCommNode,
  connectors: ConnectorsNode,
  storage: StorageNode,
  vectorDatabase: VectorDatabaseNode,
  cron: CronNode,
} as const;
```

- [ ] **Step 4: Add cron case to PropertiesPanel.tsx**

Add import:

```typescript
import CronProperties from './property-editors/CronProperties';
```

Add case before the closing of the switch:

```typescript
    case 'cron':
      return <CronProperties nodeId={nodeId} data={data} />;
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/nodes/CronNode.tsx src/panels/property-editors/CronProperties.tsx src/nodes/node-registry.ts src/panels/PropertiesPanel.tsx
git commit -m "feat: add CronNode canvas component and property editor"
```

---

### Task 11: Branch tree types + server endpoints + parentSessionId

**Files:**
- Modify: `shared/storage-types.ts`
- Modify: `server/runtime/session-router.ts`
- Modify: `server/runtime/session-transcript-store.ts`
- Modify: `server/index.ts`
- Modify: `src/runtime/storage-client.ts`

- [ ] **Step 1: Add tree navigation types to shared/storage-types.ts**

Add `parentSessionId` to `SessionStoreEntry`:

```typescript
export interface SessionStoreEntry {
  // ... existing fields ...
  compactionCount: number;
  memoryFlushAt?: string;
  memoryFlushCompactionCount?: number;
  parentSessionId?: string;
}
```

Add tree types at the end of the file:

```typescript
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
```

- [ ] **Step 2: Set parentSessionId in SessionRouter.resetSession**

In `server/runtime/session-router.ts`, in the `resetSession` method, add `parentSessionId` to the replacement object (around line 66):

```typescript
    const replacement: Partial<SessionStoreEntry> = {
      sessionId: created.sessionId,
      sessionFile: this.toStoredSessionFile(created.sessionFile),
      createdAt: timestamp,
      updatedAt: timestamp,
      parentSessionId: existing.sessionId,
      // ... rest unchanged ...
    };
```

- [ ] **Step 3: Add buildBranchTree to SessionTranscriptStore**

In `server/runtime/session-transcript-store.ts`, add the import and method:

```typescript
import type { BranchTree, ForkPoint } from '../../shared/storage-types';
```

Add the method:

```typescript
buildBranchTree(sessionFile: string): BranchTree {
  const entries = this.readTranscript(sessionFile);
  const messageEntries = entries.filter((e) => e.type === 'message' || e.type === 'compaction');

  if (messageEntries.length === 0) {
    return { forkPoints: [], defaultPath: [], totalEntries: 0 };
  }

  // Build adjacency list: parentId -> children
  const children = new Map<string | null, typeof messageEntries>();
  for (const entry of messageEntries) {
    const parentId = entry.parentId;
    if (!children.has(parentId)) {
      children.set(parentId, []);
    }
    children.get(parentId)!.push(entry);
  }

  // Find fork points (entries with >1 child)
  const forkPoints: ForkPoint[] = [];
  for (const [parentId, kids] of children) {
    if (kids.length > 1 && parentId !== null) {
      const parentEntry = messageEntries.find((e) => e.id === parentId);
      forkPoints.push({
        entryId: parentId,
        timestamp: parentEntry?.timestamp ?? '',
        branches: kids.map((kid, i) => {
          // Count entries on this branch
          let count = 0;
          let current: string | undefined = kid.id;
          while (current) {
            count++;
            const nextChildren = children.get(current);
            current = nextChildren?.[nextChildren.length - 1]?.id;
          }

          const msg = kid.message as { role?: string; content?: unknown } | undefined;
          const content = typeof msg?.content === 'string' ? msg.content : '';
          const preview = content.slice(0, 100);

          return {
            branchId: kid.id,
            label: `Branch ${i + 1}`,
            preview,
            timestamp: kid.timestamp,
            entryCount: count,
          };
        }),
      });
    }
  }

  // Build default path (follow latest child at each fork)
  const defaultPath: string[] = [];
  const roots = children.get(null) ?? [];
  let current = roots[roots.length - 1];
  while (current) {
    defaultPath.push(current.id);
    const kids = children.get(current.id);
    current = kids?.[kids.length - 1];
  }

  return {
    forkPoints,
    defaultPath,
    totalEntries: messageEntries.length,
  };
}
```

- [ ] **Step 4: Add REST endpoints to server/index.ts**

Add before the health check route:

```typescript
app.get('/api/sessions/:agentId/:sessionKey/branches', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateSessionRouter(parsedConfig, agentName, req.params.agentId);
    const status = await router.getStatus(req.params.sessionKey);

    if (!status) {
      res.status(404).json({ error: `Session ${req.params.sessionKey} not found` });
      return;
    }

    const engine = getOrCreateEngine(parsedConfig, agentName);
    const transcriptStore = getOrCreateTranscriptStore(parsedConfig, agentName);
    const transcriptPath = engine.resolveTranscriptPath(status);
    const branchTree = transcriptStore.buildBranchTree(transcriptPath);
    res.json(branchTree);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get('/api/sessions/:agentId/:sessionKey/lineage', async (req, res) => {
  const { config, agentName } = req.query as { config: string; agentName: string };
  try {
    const parsedConfig = JSON.parse(config) as ResolvedStorageConfig;
    const router = getOrCreateSessionRouter(parsedConfig, agentName, req.params.agentId);
    const engine = getOrCreateEngine(parsedConfig, agentName);
    const status = await router.getStatus(req.params.sessionKey);

    if (!status) {
      res.status(404).json({ error: `Session ${req.params.sessionKey} not found` });
      return;
    }

    const current = {
      sessionId: status.sessionId,
      sessionKey: status.sessionKey,
      createdAt: status.createdAt,
    };

    const ancestors: Array<{ sessionId: string; sessionKey: string; createdAt: string }> = [];
    let parentId = status.parentSessionId;
    while (parentId) {
      const parent = await engine.getSessionById(parentId);
      if (!parent) break;
      ancestors.push({
        sessionId: parent.sessionId,
        sessionKey: parent.sessionKey,
        createdAt: parent.createdAt,
      });
      parentId = parent.parentSessionId;
    }

    res.json({ current, ancestors });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
```

- [ ] **Step 5: Add client methods to StorageClient**

Add imports at the top of `src/runtime/storage-client.ts`:

```typescript
import type { SessionStoreEntry, MemoryFileInfo, MaintenanceReport, BranchTree, SessionLineage } from '../../shared/storage-types';
```

Add methods:

```typescript
async fetchBranchTree(sessionKey: string): Promise<BranchTree> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}/branches?${this.queryStr()}`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async fetchLineage(sessionKey: string): Promise<SessionLineage> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(this.agentId)}/${encodeURIComponent(sessionKey)}/lineage?${this.queryStr()}`,
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add shared/storage-types.ts server/runtime/session-router.ts server/runtime/session-transcript-store.ts server/index.ts src/runtime/storage-client.ts
git commit -m "feat: add branch tree types, endpoints, and parentSessionId tracking"
```

---

### Task 12: Tree navigation UI components + store

**Files:**
- Modify: `src/store/session-store.ts`
- Create: `src/components/BranchIndicator.tsx`
- Create: `src/components/BranchSwitcher.tsx`
- Create: `src/components/SessionLineageBar.tsx`

- [ ] **Step 1: Extend session-store with branch state**

In `src/store/session-store.ts`, add imports:

```typescript
import type { SessionStoreEntry, BranchTree, SessionLineage } from '../../shared/storage-types';
```

Add to the `SessionStore` interface:

```typescript
activeBranch: Record<string, string[]>;
fetchBranchTree: (sessionKey: string) => Promise<BranchTree | null>;
selectBranch: (sessionKey: string, branchPath: string[]) => void;
fetchLineage: (sessionKey: string) => Promise<SessionLineage | null>;
```

Add to the store implementation:

```typescript
activeBranch: {},

fetchBranchTree: async (sessionKey) => {
  const session = get().sessions[sessionKey];
  if (!session) return null;
  const storageEngine = get().storageEngines[session.agentId] ?? get().storageEngine;
  if (!storageEngine) return null;
  return storageEngine.fetchBranchTree(sessionKey);
},

selectBranch: (sessionKey, branchPath) => {
  set((state) => ({
    activeBranch: { ...state.activeBranch, [sessionKey]: branchPath },
  }));
},

fetchLineage: async (sessionKey) => {
  const session = get().sessions[sessionKey];
  if (!session) return null;
  const storageEngine = get().storageEngines[session.agentId] ?? get().storageEngine;
  if (!storageEngine) return null;
  return storageEngine.fetchLineage(sessionKey);
},
```

- [ ] **Step 2: Create BranchIndicator.tsx**

Create `src/components/BranchIndicator.tsx`:

```tsx
import { GitBranch } from 'lucide-react';

interface Props {
  branchCount: number;
  onClick: () => void;
}

export default function BranchIndicator({ branchCount, onClick }: Props) {
  if (branchCount <= 1) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="my-1 flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/60 px-2 py-1 text-[10px] text-slate-400 transition hover:border-slate-500 hover:text-slate-300"
    >
      <GitBranch size={12} />
      <span>{branchCount} branches</span>
    </button>
  );
}
```

- [ ] **Step 3: Create BranchSwitcher.tsx**

Create `src/components/BranchSwitcher.tsx`:

```tsx
import type { BranchInfo } from '../../shared/storage-types';

interface Props {
  branches: BranchInfo[];
  activeBranchId?: string;
  onSelect: (branchId: string) => void;
  onClose: () => void;
}

export default function BranchSwitcher({ branches, activeBranchId, onSelect, onClose }: Props) {
  return (
    <div className="absolute z-50 mt-1 w-64 rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-xs font-semibold text-slate-300">Branches</span>
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Close
        </button>
      </div>
      <div className="max-h-60 overflow-y-auto p-1">
        {branches.map((branch) => (
          <button
            key={branch.branchId}
            type="button"
            onClick={() => onSelect(branch.branchId)}
            className={`w-full rounded-md px-3 py-2 text-left transition ${
              branch.branchId === activeBranchId
                ? 'bg-slate-800 text-slate-200'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-300'
            }`}
          >
            <div className="text-xs font-medium">{branch.label}</div>
            <div className="mt-0.5 truncate text-[10px] text-slate-500">
              {branch.preview || 'No preview'}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-slate-600">
              <span>{branch.entryCount} messages</span>
              <span>{new Date(branch.timestamp).toLocaleString()}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create SessionLineageBar.tsx**

Create `src/components/SessionLineageBar.tsx`:

```tsx
import { ChevronRight } from 'lucide-react';
import type { SessionLineage } from '../../shared/storage-types';

interface Props {
  lineage: SessionLineage;
  onNavigate: (sessionKey: string) => void;
}

export default function SessionLineageBar({ lineage, onNavigate }: Props) {
  if (lineage.ancestors.length === 0) return null;

  return (
    <div className="flex items-center gap-1 border-b border-slate-800 bg-slate-900/80 px-3 py-1.5 text-[10px] text-slate-400">
      {[...lineage.ancestors].reverse().map((ancestor) => (
        <span key={ancestor.sessionId} className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onNavigate(ancestor.sessionKey)}
            className="rounded px-1 py-0.5 hover:bg-slate-800 hover:text-slate-300"
          >
            {new Date(ancestor.createdAt).toLocaleDateString()}
          </button>
          <ChevronRight size={10} className="text-slate-600" />
        </span>
      ))}
      <span className="font-medium text-slate-300">
        Current ({new Date(lineage.current.createdAt).toLocaleDateString()})
      </span>
    </div>
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/store/session-store.ts src/components/BranchIndicator.tsx src/components/BranchSwitcher.tsx src/components/SessionLineageBar.tsx
git commit -m "feat: add tree navigation UI components and session store branch state"
```

---

## Verification

After all 12 tasks:

1. **Run full test suite:** `npx vitest run`
   - StorageEngine maintenance tests pass
   - MaintenanceScheduler tests pass
   - SubAgentRegistry tests pass
   - Session tools tests pass
   - CronScheduler tests pass

2. **TypeScript check:** `npx tsc --noEmit` — no errors

3. **Manual verification:**
   - Add a Storage node, verify Maintenance section appears in properties
   - Add a Cron node, connect to agent, verify schedule/prompt fields
   - Open DataMaintenance section, click "Run Maintenance", verify report
   - Start the server, verify maintenance scheduler logs on startup
   - Create and reset a session, verify lineage endpoint returns parent chain

4. **Docs to update:**
   - `docs/concepts/storage-node.md` — maintenance config, sessions.json format
   - New: `docs/concepts/cron-node.md` — cron node concept doc using `docs/concepts/_template.md`
   - `docs/concepts/_manifest.json` — add cron entry
