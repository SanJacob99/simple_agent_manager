#!/usr/bin/env node
/**
 * SAM dev-server supervisor — exists only during a `sam restart`.
 *
 * Spawned detached by `bin/commands/restart.js`. Steps:
 *   1. If `.sam/server.pid` exists AND /api/health responds, SIGTERM
 *      that PID and wait for /api/health to fail (fall back to
 *      SIGKILL on timeout). If health doesn't respond up front, the
 *      pid file is stale or the process is something else — skip.
 *   2. Spawn a fresh `node --watch-path=./server --watch-path=./shared
 *      --import tsx server/index.ts` detached + unref'd. The new
 *      server will write its own server.pid on listen.
 *   3. Poll /api/health until it responds (or timeout).
 *   4. Exit. The new server's startup hook will also delete
 *      `.sam/supervisor.pid` and SIGTERM us as belt-and-suspenders.
 *
 * Plain ESM JS — same constraint as the CLI dispatcher.
 *
 * Caveat: This assumes the server was started via the dev-server entry
 * (or by us). If the operator runs `npm run dev` (concurrently +
 * vite), tearing the server down also tears down vite, because
 * concurrently exits when one child dies. Restart still completes,
 * but the operator needs to re-run `npm run dev` to bring vite back.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { repoRoot, SERVER_PID_FILE, SUPERVISOR_PID_FILE } from './lib/sam-paths.js';

const PORT = parseInt(process.env.STORAGE_PORT ?? '3210', 10);
const HEALTH_URL = `http://localhost:${PORT}/api/health`;
const REPO_ROOT = repoRoot();

const STOP_TIMEOUT_MS = 5000;
const KILL_TIMEOUT_MS = 2000;
const BOOT_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 300;

async function isServerAlive(timeoutMs = 1000) {
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForHealthy(predicate, totalMs) {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

function readServerPid() {
  try {
    const raw = fs.readFileSync(SERVER_PID_FILE, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error(`[supervisor] cannot read server.pid: ${err.message}`);
    }
    return null;
  }
}

async function stopExistingServer() {
  const pid = readServerPid();
  if (!pid) {
    console.log('[supervisor] no server.pid — nothing to stop.');
    return;
  }

  // Verify it's a sam server before sending signals. If health doesn't
  // respond, treat the pidfile as stale and skip the kill — important
  // on Windows where SIGTERM is TerminateProcess and a recycled PID
  // could belong to anything.
  if (!(await isServerAlive(1500))) {
    console.log(`[supervisor] server.pid=${pid} but /api/health unreachable — treating as stale, skipping kill.`);
    return;
  }

  console.log(`[supervisor] stopping existing server (pid=${pid})`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    console.log(`[supervisor] SIGTERM failed (${err.message}) — process may already be gone.`);
    return;
  }
  const stopped = await waitForHealthy(async () => !(await isServerAlive()), STOP_TIMEOUT_MS);
  if (!stopped) {
    console.log('[supervisor] still alive after SIGTERM — sending SIGKILL.');
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already dead
    }
    await waitForHealthy(async () => !(await isServerAlive()), KILL_TIMEOUT_MS);
  }
}

function spawnFreshServer() {
  console.log('[supervisor] spawning new dev:server');
  // Redirect the new server's output to a rolling log inside .sam/ so a
  // crash isn't silent (stdio: 'ignore' would lose everything). The
  // file descriptors stay open after the supervisor exits — required for
  // the child to keep running detached on Windows.
  const logPath = path.join(path.dirname(SUPERVISOR_PID_FILE), 'server.log');
  const out = fs.openSync(logPath, 'a');
  const err = fs.openSync(logPath, 'a');
  const child = spawn(
    process.execPath,
    [
      '--watch-path=./server',
      '--watch-path=./shared',
      '--import',
      'tsx',
      'server/index.ts',
    ],
    {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: REPO_ROOT,
      windowsHide: true,
    },
  );
  child.unref();
}

async function main() {
  console.log(`[supervisor] pid=${process.pid} target=${HEALTH_URL}`);

  await stopExistingServer();
  spawnFreshServer();

  console.log(`[supervisor] waiting for /api/health (timeout ${BOOT_TIMEOUT_MS}ms)`);
  const booted = await waitForHealthy(() => isServerAlive(), BOOT_TIMEOUT_MS);
  if (booted) {
    console.log(`[supervisor] server up at http://localhost:${PORT}`);
  } else {
    console.error(`[supervisor] server did not respond on ${HEALTH_URL} within ${BOOT_TIMEOUT_MS}ms`);
  }

  // Best-effort cleanup of our own pid file. The fresh server's startup
  // hook also deletes it; whichever wins, the file is gone.
  try {
    fs.rmSync(SUPERVISOR_PID_FILE, { force: true });
  } catch {
    // best-effort
  }

  process.exit(booted ? 0 : 1);
}

main().catch((err) => {
  console.error(`[supervisor] fatal: ${err?.stack ?? err}`);
  try {
    fs.rmSync(SUPERVISOR_PID_FILE, { force: true });
  } catch {
    // best-effort
  }
  process.exit(1);
});
