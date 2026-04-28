/**
 * `sam restart` — stop the running backend and start a fresh one.
 *
 * Runs the kill / spawn / health-poll loop inline (no separate
 * supervisor process). The CLI blocks for the duration of the restart
 * (~5–15s typical) and prints progress so the wait feels purposeful;
 * when /api/health responds we exit and the new server keeps running
 * detached.
 *
 * The detached child uses file-redirected stdio under `.sam/server.log`
 * — required on Windows so the child survives our own exit, and useful
 * everywhere because crash output isn't lost.
 *
 * Why no `--watch-path`: Node's internal `--watch[-path]` mode spawns
 * the watched script in its own subprocess, and that internal spawn
 * does not inherit our `windowsHide`, so the inner console window
 * pops up on Windows. Auto-reload-on-edit is what the long-running
 * `npm run dev:server` is for; `sam restart` is the manual restart
 * trigger and stays clean.
 *
 * Caveat: if the project was launched via `npm run dev` (concurrently
 * + vite), tearing down the server takes vite with it because
 * concurrently exits when one child dies. Re-run `npm run dev` after
 * the restart to bring vite back. Production supervisors (systemd,
 * PM2) are not detected.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { repoRoot, SAM_DIR, SERVER_PID_FILE } from '../lib/sam-paths.js';

const STOP_TIMEOUT_MS = 5000;
const KILL_TIMEOUT_MS = 2000;
const BOOT_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 300;

export async function runRestart(_args) {
  const REPO_ROOT = repoRoot();
  const PORT = parseInt(process.env.STORAGE_PORT ?? '3210', 10);
  const HEALTH_URL = `http://localhost:${PORT}/api/health`;

  fs.mkdirSync(SAM_DIR, { recursive: true });

  await stopExistingServer(HEALTH_URL);
  spawnFreshServer(REPO_ROOT);

  process.stdout.write(`sam: waiting for ${HEALTH_URL} ...`);
  const booted = await waitFor(() => isReachable(HEALTH_URL), BOOT_TIMEOUT_MS);
  if (booted) {
    console.log(' ok');
    console.log(`sam: server up at http://localhost:${PORT}`);
  } else {
    console.log(' timeout');
    console.error(`sam: server did not respond within ${BOOT_TIMEOUT_MS}ms — check .sam/server.log`);
    process.exit(1);
  }
}

async function stopExistingServer(healthUrl) {
  const pid = readServerPid();
  if (pid === null) {
    console.log('sam: no .sam/server.pid — nothing to stop.');
    return;
  }
  if (!(await isReachable(healthUrl, 1500))) {
    console.log(`sam: server.pid=${pid} but ${healthUrl} unreachable — treating as stale, skipping kill.`);
    return;
  }

  console.log(`sam: stopping running server (pid=${pid})`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    console.log(`sam: SIGTERM failed (${err.message}) — process may already be gone.`);
    return;
  }
  const stopped = await waitFor(async () => !(await isReachable(healthUrl)), STOP_TIMEOUT_MS);
  if (!stopped) {
    console.log('sam: still alive after SIGTERM — sending SIGKILL.');
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already dead
    }
    await waitFor(async () => !(await isReachable(healthUrl)), KILL_TIMEOUT_MS);
  }
}

function spawnFreshServer(REPO_ROOT) {
  console.log('sam: starting new server');
  const logPath = path.join(SAM_DIR, 'server.log');
  // Truncate so the log reflects this run, not a growing append.
  const out = fs.openSync(logPath, 'w');
  const err = fs.openSync(logPath, 'a');
  // Known limitation on Windows: this spawn briefly pops a console
  // window for the dev:server. Node's `windowsHide: true` only sets
  // SW_HIDE (works for GUI apps); the flag that actually suppresses
  // console allocation for a console app is CREATE_NO_WINDOW, which
  // Node does not expose. The reliable workarounds (PowerShell
  // Start-Process, VBS Shell.Run, `cmd /c start /B`) were attempted
  // and each failed in this environment for different quoting /
  // cwd reasons. Until that's resolved, the window is a known cost.
  // If you want to avoid it, run `npm run dev:server` directly and
  // skip `sam restart`.
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'server/index.ts'],
    {
      detached: true,
      stdio: ['ignore', out, err],
      cwd: REPO_ROOT,
      windowsHide: true,
    },
  );
  child.unref();
}

function readServerPid() {
  try {
    const raw = fs.readFileSync(SERVER_PID_FILE, 'utf8').trim();
    const pid = parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.error(`sam: cannot read server.pid: ${err.message}`);
    }
    return null;
  }
}

async function isReachable(url, timeoutMs = 1000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(predicate, totalMs) {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}
