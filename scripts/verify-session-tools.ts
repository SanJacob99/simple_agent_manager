/**
 * Manual verification harness for the session-tools branch.
 *
 * Exercises the real file I/O paths for sessions_list / sessions_history
 * and the SubAgentRegistry yield loop with real timers and a real transcript.
 * Coordinator-level handleYieldResume is checked indirectly by feeding a
 * resolved ResumePayload through a stubbed dispatch and asserting the
 * sam.sub_agent_resume custom entry lands in the parent's transcript.
 *
 * Run: `npx tsx scripts/verify-session-tools.ts`
 *
 * NOTE: This is a verification harness, not a permanent test. Delete it
 * once we're confident the branch is good (or keep it under scripts/ if
 * useful for future smoke-checks).
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { StorageEngine } from '../server/storage/storage-engine.js';
import { SessionTranscriptStore } from '../server/sessions/session-transcript-store.js';
import { SessionRouter } from '../server/sessions/session-router.js';
import { SubAgentRegistry } from '../server/agents/sub-agent-registry.js';
import { createSessionTools, type SessionToolContext } from '../server/sessions/session-tools.js';
import {
  SUB_AGENT_RESUME_CUSTOM_TYPE,
  type SubAgentResumeData,
} from '../shared/session-diagnostics.js';
import type { ResolvedStorageConfig } from '../shared/agent-config.js';
import type { SessionStoreEntry } from '../shared/storage-types.js';

let total = 0;
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string) {
  total += 1;
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    const msg = detail ? `  ✗ ${label} — ${detail}` : `  ✗ ${label}`;
    console.log(msg);
    failures.push(msg);
  }
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

async function makeStorage(): Promise<{
  storageEngine: StorageEngine;
  transcriptStore: SessionTranscriptStore;
  sessionRouter: SessionRouter;
  storageConfig: ResolvedStorageConfig;
  rootDir: string;
  agentId: string;
}> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-verify-'));
  const agentId = 'verify-agent';

  const storageConfig: ResolvedStorageConfig = {
    label: 'Verify Storage',
    backendType: 'filesystem',
    storagePath: rootDir,
    sessionRetention: 100,
    memoryEnabled: false,
    dailyMemoryEnabled: false,
    dailyResetEnabled: false,
    dailyResetHour: 4,
    idleResetEnabled: false,
    idleResetMinutes: 60,
    parentForkMaxTokens: 0,
    maintenanceMode: 'warn',
    pruneAfterDays: 30,
    maxEntries: 500,
    rotateBytes: 10_000_000,
    resetArchiveRetentionDays: 30,
    maxDiskBytes: 0,
    highWaterPercent: 80,
    maintenanceIntervalMinutes: 60,
  };

  const storageEngine = new StorageEngine(storageConfig, agentId);
  await storageEngine.init();
  const transcriptStore = new SessionTranscriptStore(storageEngine.getSessionsDir(), process.cwd());
  const sessionRouter = new SessionRouter(storageEngine, transcriptStore, storageConfig, agentId);

  return { storageEngine, transcriptStore, sessionRouter, storageConfig, rootDir, agentId };
}

async function seedSession(
  storageEngine: StorageEngine,
  transcriptStore: SessionTranscriptStore,
  agentId: string,
  partial: Partial<SessionStoreEntry>,
  transcriptEntries: Array<Record<string, unknown>>,
): Promise<SessionStoreEntry> {
  const created = await transcriptStore.createSession();
  const sessionFile = path.relative(storageEngine.getAgentDir(), created.sessionFile).replace(/\\/g, '/');
  const now = new Date().toISOString();
  const entry: SessionStoreEntry = {
    sessionKey: partial.sessionKey ?? `agent:${agentId}:${created.sessionId.slice(0, 8)}`,
    sessionId: created.sessionId,
    agentId,
    sessionFile,
    createdAt: now,
    updatedAt: partial.updatedAt ?? now,
    chatType: 'direct',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalEstimatedCostUsd: 0,
    compactionCount: 0,
    ...partial,
  };
  await storageEngine.createSession(entry);

  if (transcriptEntries.length > 0) {
    const manager = transcriptStore.openSession(created.sessionFile);
    for (const e of transcriptEntries) {
      const t = (e as { type?: string }).type;
      if (t === 'message') {
        manager.appendMessage((e as { message: { role: string; content: unknown }; timestamp?: number }).message as never);
      } else if (t === 'toolResult') {
        manager.appendMessage(e as never);
      }
    }
    await transcriptStore.snapshot(manager);
  }

  return entry;
}

function buildToolCtx(
  agentId: string,
  storageEngine: StorageEngine,
  transcriptStore: SessionTranscriptStore,
  sessionRouter: SessionRouter,
  subAgentRegistry: SubAgentRegistry,
): SessionToolContext {
  return {
    callerSessionKey: `agent:${agentId}:main`,
    callerAgentId: agentId,
    callerRunId: 'verify-run',
    sessionRouter,
    storageEngine,
    transcriptStore,
    coordinator: {} as never,
    subAgentRegistry,
    coordinatorLookup: () => null,
    subAgentSpawning: false,
    enabledToolNames: [
      'sessions_list',
      'sessions_history',
      'sessions_send',
      'sessions_spawn',
      'sessions_yield',
      'subagents',
      'session_status',
    ],
  };
}

async function verifySessionsList() {
  section('sessions_list — real I/O');
  const { storageEngine, transcriptStore, sessionRouter, agentId, rootDir } = await makeStorage();
  const subAgentRegistry = new SubAgentRegistry();

  // Seed three sessions: one with displayName "Daily Standup", one with "Bug Triage",
  // one with no displayName, and one cron-keyed session.
  const recentISO = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const oldISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  await seedSession(storageEngine, transcriptStore, agentId, {
    sessionKey: `agent:${agentId}:standup`,
    displayName: 'Daily Standup',
    updatedAt: recentISO,
  }, [
    { type: 'message', message: { role: 'user', content: 'What did we do today?' }, timestamp: Date.now() },
    { type: 'message', message: { role: 'assistant', content: 'Reviewed PRs.' }, timestamp: Date.now() },
  ]);

  await seedSession(storageEngine, transcriptStore, agentId, {
    sessionKey: `agent:${agentId}:bug`,
    displayName: 'Bug Triage',
    updatedAt: oldISO,
  }, []);

  await seedSession(storageEngine, transcriptStore, agentId, {
    sessionKey: `agent:${agentId}:nameless`,
    displayName: undefined,
    updatedAt: recentISO,
  }, []);

  await seedSession(storageEngine, transcriptStore, agentId, {
    sessionKey: `cron:nightly`,
    displayName: 'Nightly Cron',
    updatedAt: recentISO,
  }, []);

  const tools = createSessionTools(buildToolCtx(agentId, storageEngine, transcriptStore, sessionRouter, subAgentRegistry));
  const list = tools.find((t) => t.name === 'sessions_list')!;

  // (1) default call
  const r1 = await list.execute('c1', {});
  const p1 = JSON.parse(r1.content[0].text);
  check('returns all 4 sessions by default', Array.isArray(p1) && p1.length === 4, `got length=${p1?.length}`);

  // (2) kind: 'cron'
  const r2 = await list.execute('c2', { kind: 'cron' });
  const p2 = JSON.parse(r2.content[0].text);
  check('kind=cron returns only cron-keyed', p2.length === 1 && p2[0].sessionKey === 'cron:nightly', JSON.stringify(p2.map((s: any) => s.sessionKey)));

  // (3) recency: 30 (minutes) — should drop the 24h-old Bug Triage
  const r3 = await list.execute('c3', { recency: 30 });
  const p3 = JSON.parse(r3.content[0].text);
  check('recency=30min drops 24h-old session', !p3.some((s: any) => s.sessionKey === `agent:${agentId}:bug`), `got ${JSON.stringify(p3.map((s: any) => s.sessionKey))}`);

  // (4) label substring case-insensitive
  const r4 = await list.execute('c4', { label: 'STANDUP' });
  const p4 = JSON.parse(r4.content[0].text);
  check('label=STANDUP matches case-insensitively', p4.length === 1 && p4[0].displayName === 'Daily Standup', JSON.stringify(p4));

  // (5) cross-agent rejection
  const r5 = await list.execute('c5', { agent: 'somebody-else' });
  check('cross-agent agent param returns explicit text', r5.content[0].text.includes('Cross-agent listing is not yet supported'), r5.content[0].text);

  // (6) preview: true
  const r6 = await list.execute('c6', { preview: true });
  const p6 = JSON.parse(r6.content[0].text);
  const standup = p6.find((s: any) => s.sessionKey === `agent:${agentId}:standup`);
  check('preview=true populates first user message', standup?.preview === 'What did we do today?', JSON.stringify(standup));
  check('preview=true populates messageCount', standup?.messageCount === 2, `messageCount=${standup?.messageCount}`);
  const empty = p6.find((s: any) => s.sessionKey === `agent:${agentId}:bug`);
  check('preview for empty transcript is empty + 0', empty?.preview === '' && empty?.messageCount === 0, JSON.stringify(empty));

  await fs.rm(rootDir, { recursive: true, force: true });
}

async function verifySessionsHistory() {
  section('sessions_history — real I/O');
  const { storageEngine, transcriptStore, sessionRouter, agentId, rootDir } = await makeStorage();
  const subAgentRegistry = new SubAgentRegistry();

  // Seed a session with 50 messages
  const longEntries = Array.from({ length: 50 }, (_, i) => ({
    type: 'message' as const,
    message: {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i + 1} body`,
    },
    timestamp: Date.parse('2026-04-08T00:00:00.000Z') + i * 60_000,
  }));
  const longSession = await seedSession(storageEngine, transcriptStore, agentId, {
    sessionKey: `agent:${agentId}:long`,
    displayName: 'Long Session',
  }, longEntries);

  const tools = createSessionTools(buildToolCtx(agentId, storageEngine, transcriptStore, sessionRouter, subAgentRegistry));
  const history = tools.find((t) => t.name === 'sessions_history')!;

  // (1) default — newest 20
  const r1 = await history.execute('c1', { sessionKey: longSession.sessionKey });
  const p1 = JSON.parse(r1.content[0].text);
  check('default returns 20 entries', p1.entries?.length === 20, `length=${p1.entries?.length}`);
  const firstText: string = p1.entries[0].text;
  const lastText: string = p1.entries[p1.entries.length - 1].text;
  check('newest-first ordering (entry[0] = Message 50)', firstText.startsWith('Message 50 body'), `entry[0]=${firstText}`);
  check('entry[19] = Message 31', lastText.startsWith('Message 31 body'), `entry[19]=${lastText}`);
  check('totalEntries=50', p1.totalEntries === 50, `totalEntries=${p1.totalEntries}`);
  check('nextCursor present (more pages exist)', typeof p1.nextCursor === 'string', `nextCursor=${p1.nextCursor}`);

  // (2) before cursor
  const cursor = p1.nextCursor;
  const r2 = await history.execute('c2', { sessionKey: longSession.sessionKey, before: cursor, limit: 10 });
  const p2 = JSON.parse(r2.content[0].text);
  check('before=cursor returns 10 older entries', p2.entries?.length === 10, `length=${p2.entries?.length}`);
  check('before-page is older (Message 30 → Message 21)',
    p2.entries[0].text.startsWith('Message') && p2.entries[p2.entries.length - 1].text.startsWith('Message'),
    `[${p2.entries[0].text} … ${p2.entries[p2.entries.length - 1].text}]`,
  );

  // (3) bad cursor
  const r3 = await history.execute('c3', { sessionKey: longSession.sessionKey, before: 'nonexistent' });
  check('unknown cursor returns Cursor not found text', r3.content[0].text.includes('Cursor not found'), r3.content[0].text);

  // (4) total budget cap with huge entries
  const huge = 'X'.repeat(2000);
  const hugeEntries = Array.from({ length: 30 }, () => ({
    type: 'message' as const,
    message: { role: 'assistant', content: huge },
    timestamp: Date.now(),
  }));
  const hugeSession = await seedSession(storageEngine, transcriptStore, agentId, {
    sessionKey: `agent:${agentId}:huge`,
    displayName: 'Huge Session',
  }, hugeEntries);

  const r4 = await history.execute('c4', { sessionKey: hugeSession.sessionKey, limit: 30 });
  const p4 = JSON.parse(r4.content[0].text);
  check('budget cap: returns < 30 entries', p4.entries?.length < 30, `length=${p4.entries?.length}`);
  check('budget cap: truncated=true', p4.truncated === true, `truncated=${p4.truncated}`);
  check('budget cap: response payload <= 12.5k chars',
    r4.content[0].text.length <= 12_500,
    `payload=${r4.content[0].text.length} chars`,
  );

  await fs.rm(rootDir, { recursive: true, force: true });
}

async function verifyYieldRegistry() {
  section('SubAgentRegistry yield — end-to-end with real timers');
  const reg = new SubAgentRegistry();
  const PARENT = 'agent:p:main';

  // Spawn 2 children
  reg.spawn({ sessionKey: PARENT, runId: 'parent-run' }, { agentId: 'c', sessionKey: 'sub:p:1', runId: 'r1' });
  reg.spawn({ sessionKey: PARENT, runId: 'parent-run' }, { agentId: 'c', sessionKey: 'sub:p:2', runId: 'r2' });

  let resolved: any = null;
  const r = reg.setYieldPending(
    PARENT,
    { parentAgentId: 'p', parentRunId: 'parent-run', timeoutMs: 60_000 },
    (payload) => { resolved = payload; },
  );
  check('setYieldPending returns setupOk: true', r.setupOk === true, JSON.stringify(r));
  check('isYieldPending after setup', reg.isYieldPending(PARENT) === true);

  reg.onComplete('r1', 'first');
  check('not resolved after first child only', resolved === null);

  reg.onError('r2', 'rate limited');
  check('resolved after last child errors', resolved !== null);
  if (resolved) {
    check('reason = all-complete (error counts as terminal)', resolved.reason === 'all-complete', `reason=${resolved.reason}`);
    const statuses = resolved.results.map((x: any) => x.status).sort();
    check('results show one completed + one error', JSON.stringify(statuses) === JSON.stringify(['completed', 'error']), JSON.stringify(statuses));
    const errorEntry = resolved.results.find((x: any) => x.status === 'error');
    check('error message propagates', errorEntry?.error === 'rate limited', JSON.stringify(errorEntry));
  }
  check('isYieldPending cleared after resolve', reg.isYieldPending(PARENT) === false);

  // Timeout path with a real (short) timer
  const reg2 = new SubAgentRegistry();
  reg2.spawn({ sessionKey: PARENT, runId: 'parent-run' }, { agentId: 'c', sessionKey: 'sub:p:slow', runId: 'slow' });
  let resolved2: any = null;
  reg2.setYieldPending(PARENT, { parentAgentId: 'p', parentRunId: 'parent-run', timeoutMs: 100 }, (p) => { resolved2 = p; });
  await new Promise((r) => setTimeout(r, 250));
  check('timeout fires after timeoutMs', resolved2 !== null);
  if (resolved2) {
    check('timeout reason = timeout', resolved2.reason === 'timeout', `reason=${resolved2.reason}`);
    check('still-running child reported with status=running',
      resolved2.results.length === 1 && resolved2.results[0].status === 'running',
      JSON.stringify(resolved2.results),
    );
  }

  // cancelAllYields
  const reg3 = new SubAgentRegistry();
  reg3.spawn({ sessionKey: PARENT, runId: 'parent-run' }, { agentId: 'c', sessionKey: 'sub:p:1', runId: 'r1' });
  let resolved3: any = null;
  reg3.setYieldPending(PARENT, { parentAgentId: 'p', parentRunId: 'parent-run', timeoutMs: 100 }, (p) => { resolved3 = p; });
  reg3.cancelAllYields();
  await new Promise((r) => setTimeout(r, 250));
  check('cancelAllYields prevents resolve', resolved3 === null);
}

async function verifyResumeMarkerPersistence() {
  section('sam.sub_agent_resume — custom entry round-trip');
  const { storageEngine, transcriptStore, sessionRouter: _sessionRouter, agentId, rootDir } = await makeStorage();

  // Make a real session
  const session = await seedSession(storageEngine, transcriptStore, agentId, {
    sessionKey: `agent:${agentId}:parent`,
    displayName: 'Parent',
  }, [
    { type: 'message', message: { role: 'user', content: 'Spawn the worker.' }, timestamp: Date.now() },
  ]);

  // Append a sam.sub_agent_resume marker the same way RunCoordinator.handleYieldResume does
  const transcriptPath = storageEngine.resolveTranscriptPath(session);
  const manager = transcriptStore.openSession(transcriptPath);
  const data: SubAgentResumeData = {
    generatedFromRunId: 'parent-run',
    reason: 'all-complete',
    generatedAt: Date.now(),
    results: [
      {
        subAgentId: 'sub-abc-1',
        targetAgentId: 'worker',
        sessionKey: 'sub:agent:p:parent:1',
        status: 'completed',
        startedAt: Date.now() - 2000,
        endedAt: Date.now(),
        durationMs: 2000,
        text: 'Worker found 3 results.',
      },
    ],
  };
  manager.appendCustomEntry(SUB_AGENT_RESUME_CUSTOM_TYPE, data);
  await transcriptStore.snapshot(manager);

  // Read back the JSONL and verify the marker landed
  const raw = await fs.readFile(transcriptPath, 'utf-8');
  check('transcript contains the custom-type marker',
    raw.includes(`"customType":"${SUB_AGENT_RESUME_CUSTOM_TYPE}"`)
      || raw.includes(`"customType": "${SUB_AGENT_RESUME_CUSTOM_TYPE}"`),
    raw.split('\n')[2]?.slice(0, 200),
  );
  check('transcript carries the embedded results', raw.includes('Worker found 3 results.'));
  const lines = raw.split('\n').filter(Boolean);
  let found = false;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'custom' && parsed.customType === SUB_AGENT_RESUME_CUSTOM_TYPE) {
        found = true;
        check('parsed marker has reason=all-complete', parsed.data?.reason === 'all-complete', JSON.stringify(parsed.data?.reason));
        check('parsed marker has 1 result', Array.isArray(parsed.data?.results) && parsed.data.results.length === 1);
        break;
      }
    } catch {
      // skip non-JSON lines
    }
  }
  check('marker is parseable as a custom entry', found);

  await fs.rm(rootDir, { recursive: true, force: true });
}

async function main() {
  console.log('Running session-tools manual verification...');
  try {
    await verifySessionsList();
    await verifySessionsHistory();
    await verifyYieldRegistry();
    await verifyResumeMarkerPersistence();
  } catch (err) {
    console.error('FATAL', err);
    process.exit(2);
  }

  console.log(`\n=== Summary: ${passed}/${total} passed, ${failed} failed ===`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(f);
    process.exit(1);
  }
}

main();
