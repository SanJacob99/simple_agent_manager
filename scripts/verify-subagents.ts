/**
 * Manual verification harness for the sub-agent backend foundation.
 *
 * Exercises the wiring paths end-to-end with in-memory stubs:
 *   - SubAgentRegistry: spawn / onComplete / kill / sealing
 *   - SubAgentExecutor: dispatch with abort plumbing
 *   - RunCoordinator: runtime-factory child dispatch with mock runtime
 *   - sessions_send: one-shot rejection for sub-session keys (via parser)
 *   - REST: POST /api/subagents/:id/kill flow
 *
 *
 * Run: `npx tsx scripts/verify-subagents.ts`
 */

import express from 'express';
import http from 'http';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { SubAgentRegistry } from '../server/agents/sub-agent-registry.js';
import { SubAgentExecutor } from '../server/agents/sub-agent-executor.js';
import { RunCoordinator } from '../server/agents/run-coordinator.js';
import { mountSubAgentRoutes } from '../server/routes/subagents.js';
import { parseSubSessionKey, buildSubSessionKey } from '../server/agents/sub-session-key.js';
import { StorageEngine } from '../server/storage/storage-engine.js';
import { SessionTranscriptStore } from '../server/sessions/session-transcript-store.js';
import type { AgentConfig } from '../shared/agent-config.js';

let total = 0;
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail?: string) {
  total += 1;
  if (ok) {
    passed += 1;
    console.log(`  ok ${label}`);
  } else {
    failed += 1;
    failures.push(label + (detail ? ` (${detail})` : ''));
    console.log(`  fail ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

function makeAgentConfig(storagePath: string): AgentConfig {
  return {
    id: 'agent-runtime-verify',
    version: 3,
    name: 'RuntimeVerify',
    description: '',
    tags: [],
    provider: { pluginId: 'openai', authMethodId: '', envVar: '', baseUrl: '' },
    modelId: 'gpt-4',
    thinkingLevel: 'off',
    systemPrompt: { mode: 'manual', sections: [], assembled: 'Parent prompt', userInstructions: 'Parent prompt' },
    modelCapabilities: {},
    memory: null,
    tools: {
      profile: 'custom',
      resolvedTools: [],
      enabledGroups: [],
      skills: [],
      plugins: [],
      subAgentSpawning: false,
      maxSubAgents: 0,
    },
    contextEngine: null,
    connectors: [],
    agentComm: [],
    storage: {
      label: 'Storage',
      backendType: 'filesystem',
      storagePath,
      sessionRetention: 50,
      memoryEnabled: false,
      dailyMemoryEnabled: false,
      dailyResetEnabled: false,
      dailyResetHour: 4,
      idleResetEnabled: false,
      idleResetMinutes: 60,
      parentForkMaxTokens: 100000,
      maintenanceMode: 'warn',
      pruneAfterDays: 30,
      maxEntries: 100,
      rotateBytes: 1048576,
      resetArchiveRetentionDays: 7,
      maxDiskBytes: 104857600,
      highWaterPercent: 80,
      maintenanceIntervalMinutes: 60,
    },
    vectorDatabases: [],
    crons: [],
    mcps: [],
    subAgents: [],
    workspacePath: null,
    exportedAt: Date.now(),
    sourceGraphId: 'runtime-verify',
    runTimeoutMs: 60000,
  };
}

function makeMockRuntime(reply: string) {
  const listeners = new Set<(event: any) => void>();
  const runtime: any = {
    state: { messages: [], model: { api: 'openai-completions' } },
    lastApiError: null,
    subscribe: (listener: (event: any) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    prompt: async () => {
      const message = {
        role: 'assistant',
        content: [{ type: 'text', text: reply }],
        api: 'openai-completions',
        provider: 'openai',
        model: 'gpt-4',
        usage: { input: 1, output: 1, totalTokens: 2, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'stop',
        timestamp: Date.now(),
      };
      for (const listener of listeners) {
        listener({ type: 'message_start', message: { role: 'assistant' } });
        listener({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: reply },
        });
        listener({
          type: 'message_update',
          assistantMessageEvent: { type: 'text_end', contentIndex: 0, content: reply },
        });
        listener({ type: 'message_end', message });
      }
    },
    abort: () => {},
    destroy: () => {},
    setSessionContext: (messages: any[]) => { runtime.state.messages = [...messages]; },
    setActiveSession: () => {},
    clearActiveSession: () => {},
    setCurrentSessionKey: () => {},
    setModel: () => {},
    setSystemPrompt: (prompt: string) => { runtime.state.systemPrompt = prompt; },
    getSystemPrompt: () => runtime.state.systemPrompt ?? 'Child prompt',
    getResolvedSystemPrompt: () => ({
      mode: 'manual',
      sections: [],
      assembled: 'Child prompt',
      userInstructions: 'Child prompt',
    }),
  };
  return runtime;
}

async function main() {
  console.log('Sub-agent backend verification harness');
  console.log('======================================\n');

  // -- 1. Sub-session key parser ---------------------------------------------
  console.log('1. Sub-session key parser');
  const k = buildSubSessionKey('agent:a:main', 'researcher', 'abc123');
  check('builds raw sub:* key', k === 'sub:agent:a:main:researcher:abc123');
  const parsed = parseSubSessionKey(k);
  check('parses raw key back', parsed?.parentSessionKey === 'agent:a:main' && parsed?.subAgentName === 'researcher' && parsed?.shortUuid === 'abc123');
  check('rejects non-sub key', parseSubSessionKey('agent:a:main') === null);
  check('rejects truncated key', parseSubSessionKey('sub:agent:a:main:researcher') === null);
  check('rejects bad name regex', parseSubSessionKey('sub:agent:a:main:Researcher:abc') === null);
  console.log();

  // -- 2. Registry: spawn -> complete -> seal ----------------------------------
  console.log('2. Registry: spawn -> complete -> seal');
  const reg1 = new SubAgentRegistry();
  const rec1 = reg1.spawn(
    { sessionKey: 'agent:a:main', runId: 'pr1' },
    {
      agentId: 'a',
      sessionKey: 'sub:agent:a:main:researcher:abc',
      runId: 'cr1',
      subAgentName: 'researcher',
      appliedOverrides: { thinkingLevel: 'high' },
    },
  );
  check('spawn returns running record', rec1.status === 'running' && rec1.sealed === false);
  check('spawn records appliedOverrides', JSON.stringify(rec1.appliedOverrides) === '{"thinkingLevel":"high"}');
  reg1.onComplete('cr1', 'researched X');
  const after1 = reg1.get(rec1.subAgentId);
  check('onComplete flips status to completed', after1?.status === 'completed');
  check('onComplete seals the record', after1?.sealed === true);
  check('result text recorded', after1?.result === 'researched X');
  console.log();

  // -- 3. Registry: kill flow preserves "killed" terminal state --------------
  console.log('3. Registry: kill preserves killed (does not get clobbered to error)');
  const reg2 = new SubAgentRegistry();
  const rec2 = reg2.spawn(
    { sessionKey: 'agent:a:main', runId: 'pr2' },
    {
      agentId: 'a',
      sessionKey: 'sub:agent:a:main:researcher:def',
      runId: 'cr2',
      subAgentName: 'researcher',
      appliedOverrides: {},
    },
  );
  reg2.kill(rec2.subAgentId);
  reg2.onError('cr2', 'aborted'); // simulate the abort signal landing AFTER kill
  const after2 = reg2.get(rec2.subAgentId);
  check('kill flips status to killed', after2?.status === 'killed');
  check('onError after kill does NOT overwrite killed', after2?.status !== 'error');
  check('killed records are sealed', after2?.sealed === true);
  console.log();

  // -- 4. Executor: completes through a fake bridge --------------------------
  console.log('4. Executor: completes through a fake runChild bridge');
  const events: any[] = [];
  const exec1 = new SubAgentExecutor({
    runChild: async (opts) => {
      opts.emit({ type: 'message', text: 'fake reply' });
      return { status: 'completed', text: 'fake reply' };
    },
    eventBus: { emit: (e) => events.push(e) },
  });
  const result1 = await exec1.dispatch({
    childRunId: 'child-1',
    childSessionKey: 'sub:agent:a:main:researcher:abc',
    syntheticConfig: {} as any,
    message: 'go',
    onAbortRegister: () => {},
  });
  check('executor returns completed', result1.status === 'completed' && result1.text === 'fake reply');
  check('events tagged with childRunId', events.some((e) => e.runId === 'child-1'));
  console.log();

  // -- 5. Executor: abort propagates through reassigned onAbort --------------
  console.log('5. Executor: abort propagates via onAbort handover');
  let abortFn: () => void = () => {};
  const exec2 = new SubAgentExecutor({
    runChild: (opts) => new Promise((resolve) => {
      opts.onAbort = () => resolve({ status: 'aborted' });
    }),
    eventBus: { emit: () => {} },
  });
  const dispatchP = exec2.dispatch({
    childRunId: 'child-2',
    childSessionKey: 'sub:agent:a:main:researcher:def',
    syntheticConfig: {} as any,
    message: 'go',
    onAbortRegister: (fn) => { abortFn = fn; },
  });
  abortFn();
  const result2 = await dispatchP;
  check('abort propagates to runChild', result2.status === 'aborted');
  console.log();

  // -- 6. REST kill: aborts in-flight child and marks killed -----------------
  console.log('6. REST kill: full server flow');
  const reg3 = new SubAgentRegistry();
  const rec3 = reg3.spawn(
    { sessionKey: 'agent:a:main', runId: 'pr3' },
    {
      agentId: 'a',
      sessionKey: 'sub:agent:a:main:researcher:xyz',
      runId: 'cr3',
      subAgentName: 'researcher',
      appliedOverrides: {},
    },
  );

  let abortRunId: string | null = null;
  const app = express();
  app.use(express.json());
  mountSubAgentRoutes(app, {
    registry: reg3,
    abortRun: (rid) => { abortRunId = rid; },
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${typeof addr !== 'string' && addr ? addr.port : 0}`;

  try {
    const killRes = await fetch(`${baseUrl}/api/subagents/${rec3.subAgentId}/kill`, { method: 'POST' });
    check('POST /kill returns 200', killRes.status === 200);
    const killBody = await killRes.json();
    check('POST /kill body { killed: true }', killBody.killed === true);
    check('REST kill triggers abortRun', abortRunId === 'cr3');
    check('REST kill marks record killed', reg3.get(rec3.subAgentId)?.status === 'killed');

    const get404 = await fetch(`${baseUrl}/api/subagents/nonexistent`);
    check('GET unknown id returns 404', get404.status === 404);

    const listRes = await fetch(`${baseUrl}/api/subagents?parentSessionKey=${encodeURIComponent('agent:a:main')}`);
    check('GET list-by-parent returns 200', listRes.status === 200);
    const listBody = await listRes.json();
    check('GET list-by-parent finds the killed record', Array.isArray(listBody) && listBody.length === 1);

    const list400 = await fetch(`${baseUrl}/api/subagents`);
    check('GET list without parentSessionKey returns 400', list400.status === 400);

    const reKill = await fetch(`${baseUrl}/api/subagents/${rec3.subAgentId}/kill`, { method: 'POST' });
    check('POST /kill on already-terminal returns 409', reKill.status === 409);
  } finally {
    server.close();
  }
  console.log();

  console.log('7. RunCoordinator: runtime factory bridge');
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sam-verify-subagents-'));
  try {
    const config = makeAgentConfig(tmpRoot);
    const storage = new StorageEngine(config.storage!, config.name);
    await storage.init();
    const transcriptStore = new SessionTranscriptStore(storage.getSessionsDir(), process.cwd());
    const created = await transcriptStore.createSession();
    const sessionKey = 'sub:agent:agent-runtime-verify:main:researcher:rt1';
    await storage.createSession({
      sessionKey,
      sessionId: created.sessionId,
      agentId: config.id,
      sessionFile: path.relative(storage.getAgentDir(), created.sessionFile).replace(/\\/g, '/'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      chatType: 'direct',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalEstimatedCostUsd: 0,
      compactionCount: 0,
      subAgentMeta: {
        subAgentId: 'verify-sub',
        subAgentName: 'researcher',
        parentSessionKey: 'agent:agent-runtime-verify:main',
        parentRunId: 'parent-run',
        status: 'running',
        sealed: false,
        appliedOverrides: {},
        modelId: 'gpt-4',
        providerPluginId: 'openai',
        startedAt: Date.now(),
      },
    });

    const parentRuntime = makeMockRuntime('parent') as any;
    let factoryCalled = false;
    const coordinator = new RunCoordinator(
      config.id,
      parentRuntime,
      config,
      storage,
      null,
      undefined,
      undefined,
      (childConfig) => {
        factoryCalled = true;
        check('child config strips recursive subAgents', childConfig.subAgents.length === 0);
        return makeMockRuntime('real child reply') as any;
      },
    );

    try {
      const result = await coordinator.getSubAgentExecutor().dispatch({
        childRunId: 'runtime-child-run',
        childSessionKey: sessionKey,
        syntheticConfig: {
          ...config,
          id: `${config.id}::sub::researcher`,
          name: `${config.name}/researcher`,
          subAgents: [{ name: 'would-recurse' } as any],
        },
        message: 'go',
        onAbortRegister: () => {},
      });
      const stored = await storage.getSession(sessionKey);
      check('runtime factory was called', factoryCalled);
      check('runtime bridge returns child reply', result.status === 'completed' && result.text === 'real child reply');
      check('runtime bridge seals durable metadata', stored?.subAgentMeta?.status === 'completed' && stored.subAgentMeta.sealed === true);
      check('runtime bridge persists token counters', stored?.totalTokens === 2);
    } finally {
      coordinator.destroy();
    }
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
  console.log();

  // -- Summary ----------------------------------------------------------------
  console.log('======================================');
  console.log(`Total: ${total}, Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Verification harness threw:', err);
  process.exit(1);
});
