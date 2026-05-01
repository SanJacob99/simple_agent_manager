/**
 * Manual verification harness for the sub-agent backend foundation.
 *
 * Exercises the wiring paths end-to-end with in-memory stubs:
 *   - SubAgentRegistry: spawn / onComplete / kill / sealing
 *   - SubAgentExecutor: dispatch with abort plumbing
 *   - sessions_send: one-shot rejection for sub-session keys (via parser)
 *   - REST: POST /api/subagents/:id/kill flow
 *
 * Does NOT exercise actual sub-agent runtime construction — that path is
 * stubbed in RunCoordinator.runChild pending an AgentManager-level runtime
 * factory. The harness verifies the wiring/contracts that DO ship in the
 * backend foundation slice.
 *
 * Run: `npx tsx scripts/verify-subagents.ts`
 */

import express from 'express';
import http from 'http';

import { SubAgentRegistry } from '../server/agents/sub-agent-registry.js';
import { SubAgentExecutor } from '../server/agents/sub-agent-executor.js';
import { mountSubAgentRoutes } from '../server/routes/subagents.js';
import { parseSubSessionKey, buildSubSessionKey } from '../server/agents/sub-session-key.js';

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
    failures.push(label + (detail ? ` (${detail})` : ''));
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('Sub-agent backend verification harness');
  console.log('======================================\n');

  // ── 1. Sub-session key parser ─────────────────────────────────────────────
  console.log('1. Sub-session key parser');
  const k = buildSubSessionKey('agent:a:main', 'researcher', 'abc123');
  check('builds raw sub:* key', k === 'sub:agent:a:main:researcher:abc123');
  const parsed = parseSubSessionKey(k);
  check('parses raw key back', parsed?.parentSessionKey === 'agent:a:main' && parsed?.subAgentName === 'researcher' && parsed?.shortUuid === 'abc123');
  check('rejects non-sub key', parseSubSessionKey('agent:a:main') === null);
  check('rejects truncated key', parseSubSessionKey('sub:agent:a:main:researcher') === null);
  check('rejects bad name regex', parseSubSessionKey('sub:agent:a:main:Researcher:abc') === null);
  console.log();

  // ── 2. Registry: spawn → complete → seal ──────────────────────────────────
  console.log('2. Registry: spawn → complete → seal');
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

  // ── 3. Registry: kill flow preserves "killed" terminal state ──────────────
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

  // ── 4. Executor: completes through a fake bridge ──────────────────────────
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

  // ── 5. Executor: abort propagates through reassigned onAbort ──────────────
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

  // ── 6. REST kill: aborts in-flight child and marks killed ─────────────────
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

  // ── Summary ────────────────────────────────────────────────────────────────
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
