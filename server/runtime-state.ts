/**
 * Runtime PID coordination for `sam restart`.
 *
 * Two files live under `<repo>/.sam/`:
 *   - `server.pid`     — the running server's PID. Written on listen,
 *                        best-effort deleted on graceful shutdown.
 *   - `supervisor.pid` — written by `sam restart` for the duration of
 *                        a restart. The new server reads this on boot,
 *                        SIGTERMs the supervisor (belt-and-suspenders
 *                        in case the supervisor's own health-poll loop
 *                        has stalled), and deletes the file. So the
 *                        supervisor exists only during a restart.
 *
 * The CLI mirror of this module is `bin/lib/sam-paths.js`. Keep the
 * file paths in sync.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(here), '..');

export const SAM_DIR = path.join(REPO_ROOT, '.sam');
export const SERVER_PID_FILE = path.join(SAM_DIR, 'server.pid');
export const SUPERVISOR_PID_FILE = path.join(SAM_DIR, 'supervisor.pid');

export function writeServerPid(pid: number): void {
  try {
    fs.mkdirSync(SAM_DIR, { recursive: true });
    fs.writeFileSync(SERVER_PID_FILE, String(pid), 'utf8');
  } catch (err) {
    console.error('[Server] Failed to write server.pid:', (err as Error).message);
  }
}

export function clearServerPid(): void {
  try {
    fs.rmSync(SERVER_PID_FILE, { force: true });
  } catch {
    // best-effort
  }
}

/**
 * If a `supervisor.pid` is present (left by `sam restart`), SIGTERM it
 * and remove the file. The supervisor's own health-poll exits naturally
 * when the new server's `/api/health` responds; this is the
 * belt-and-suspenders path for the case where polling stalled.
 *
 * Safe to call when no supervisor is running — missing file or dead
 * PID are both no-ops.
 */
export function reapSupervisorPid(): void {
  let raw: string;
  try {
    raw = fs.readFileSync(SUPERVISOR_PID_FILE, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    console.error('[Server] Cannot read supervisor.pid:', (err as Error).message);
    return;
  }
  const pid = parseInt(raw.trim(), 10);
  if (Number.isFinite(pid) && pid > 0) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // PID already dead — fine.
    }
  }
  try {
    fs.rmSync(SUPERVISOR_PID_FILE, { force: true });
  } catch {
    // best-effort
  }
}
